import { mkdtemp, mkdir, readFile, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

vi.mock('undici', async (importOriginal) => ({
  ...(await importOriginal<typeof import('undici')>()),
  fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
}));

vi.mock('dns/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('dns/promises')>()),
  lookup: vi.fn(() => Promise.resolve([{ address: '93.184.216.34', family: 4 }])),
}));

import { forgetDispatchers } from '../../../../common/utils/safe-fetch';
import type { ResolvedClientConfig } from '../download-client-adapter';
import { legacyStagedClientDir, stagedClientDir } from '../download-client-adapter';
import { TorboxAdapter } from './torbox.adapter';
import { TorboxApiClient } from './torbox.api';
import type { TorboxTorrent } from './torbox.api';

const CLIENT_KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);
const CLIENT_ID = 9;
/** Mirrors the adapter's MAX_FILE_BYTES, which also caps a whole release. */
const MAX_STAGE_BYTES = 8 * 1024 * 1024 * 1024;

function config(overrides: Partial<ResolvedClientConfig> = {}): ResolvedClientConfig {
  return {
    id: CLIENT_ID,
    name: 'torbox',
    adapterType: 'torbox',
    baseUrl: 'https://api.torbox.app',
    username: null,
    password: 'api-secret',
    category: '',
    allowPrivateAddress: false,
    settings: null,
    ...overrides,
  };
}

function torrent(overrides: Partial<TorboxTorrent> = {}): TorboxTorrent {
  return {
    torrentId: 42,
    hash: CLIENT_KEY,
    name: 'Dune',
    state: 'downloading',
    downloadFinished: false,
    downloadPresent: true,
    progressPercent: 50,
    downloadedBytes: 50,
    totalBytes: 100,
    ratio: 0.5,
    active: false,
    files: [{ fileId: 7, name: 'Dune.epub', size: 100 }],
    ...overrides,
  };
}

function apiMock() {
  return {
    createTorrent: vi.fn(() => Promise.resolve({ torrentId: 42, hash: CLIENT_KEY })),
    findByHashes: vi.fn(() => Promise.resolve(new Map<string, TorboxTorrent>())),
    requestDownloadLink: vi.fn(() => Promise.resolve('https://example.com/book.epub')),
    controlTorrent: vi.fn(() => Promise.resolve(undefined)),
    getUser: vi.fn(() => Promise.resolve({ email: 'reader@example.com', plan: 1 })),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function trackedBody(chunks: Uint8Array[] = [new TextEncoder().encode('book')]) {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });
  return { body, wasCancelled: () => cancelled };
}

describe('TorboxAdapter', () => {
  let appDataPath: string;
  let api: ReturnType<typeof apiMock>;
  let adapter: TorboxAdapter;

  beforeEach(async () => {
    appDataPath = await mkdtemp(join(tmpdir(), 'bookorbit-torbox-'));
    api = apiMock();
    adapter = new TorboxAdapter(api as unknown as TorboxApiClient, { getOrThrow: vi.fn(() => appDataPath) } as unknown as ConfigService);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    forgetDispatchers();
    await rm(appDataPath, { recursive: true, force: true });
  });

  it('adds a magnet with zip output disabled', async () => {
    await expect(adapter.add({ magnet: 'magnet:?xt=urn:btih:' + CLIENT_KEY, clientKey: CLIENT_KEY }, config())).resolves.toEqual({
      clientKey: CLIENT_KEY,
    });
    expect(api.createTorrent).toHaveBeenCalledWith(config(), {
      magnet: 'magnet:?xt=urn:btih:' + CLIENT_KEY,
      torrentFile: undefined,
      torrentFileName: undefined,
    });
  });

  it('adopts an existing torrent instead of creating a duplicate', async () => {
    api.findByHashes.mockResolvedValue(new Map([[CLIENT_KEY, torrent()]]));

    await expect(adapter.add({ clientKey: CLIENT_KEY }, config())).resolves.toEqual({ clientKey: CLIENT_KEY });
    expect(api.createTorrent).not.toHaveBeenCalled();
  });

  it('requires a magnet or torrent file', async () => {
    await expect(adapter.add({ clientKey: CLIENT_KEY }, config())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an invalid client key before creating a torrent', async () => {
    await expect(adapter.add({ magnet: 'magnet:?xt=urn:btih:not-a-hash', clientKey: 'not-a-hash' }, config())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(api.findByHashes).not.toHaveBeenCalled();
  });

  it('resolves when TorBox does not return a hash', async () => {
    api.createTorrent.mockResolvedValue({ torrentId: 42, hash: null });

    await expect(adapter.add({ magnet: 'magnet:?xt=urn:btih:' + CLIENT_KEY, clientKey: CLIENT_KEY }, config())).resolves.toEqual({
      clientKey: CLIENT_KEY,
    });
  });

  it('keeps a download TorBox has not finished as in progress while its files are absent', async () => {
    api.findByHashes.mockResolvedValue(new Map([[CLIENT_KEY, torrent({ downloadPresent: false })]]));

    await expect(adapter.status([CLIENT_KEY], config())).resolves.toEqual([expect.objectContaining({ clientKey: CLIENT_KEY, state: 'downloading' })]);
  });

  it('keeps a finished torrent stageable while TorBox reports its files as absent', async () => {
    const finished = torrent({
      downloadFinished: true,
      downloadPresent: false,
      progressPercent: 100,
      downloadedBytes: 4,
      totalBytes: 4,
      files: [{ fileId: 7, name: 'Dune.epub', size: 4 }],
    });
    api.findByHashes.mockResolvedValue(new Map([[CLIENT_KEY, finished]]));

    await expect(adapter.status([CLIENT_KEY], config())).resolves.toEqual([
      expect.objectContaining({ clientKey: CLIENT_KEY, state: 'completed', contentPath: null }),
    ]);

    api.requestDownloadLink.mockResolvedValue('https://example.com/Dune.epub');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(Buffer.from('book'), { headers: { 'content-length': '4' } }))),
    );

    const directory = stagedClientDir(appDataPath, 'torbox', CLIENT_ID, CLIENT_KEY);
    await expect(adapter.stage(CLIENT_KEY, config())).resolves.toEqual({ contentPath: directory });
    await expect(readFile(join(directory, 'Dune.epub'), 'utf8')).resolves.toBe('book');
  });

  it('keeps a finished torrent queued while TorBox has not listed its files', async () => {
    api.findByHashes.mockResolvedValue(
      new Map([[CLIENT_KEY, torrent({ downloadFinished: true, progressPercent: 100, downloadedBytes: 4, totalBytes: 4, files: [] })]]),
    );

    await expect(adapter.status([CLIENT_KEY], config())).resolves.toEqual([
      expect.objectContaining({ clientKey: CLIENT_KEY, state: 'queued', contentPath: null }),
    ]);
  });

  it('completes a finished torrent once a later poll reports the files it was missing', async () => {
    const finished = torrent({ downloadFinished: true, progressPercent: 100, downloadedBytes: 4, totalBytes: 4, files: [] });
    api.findByHashes
      .mockResolvedValueOnce(new Map([[CLIENT_KEY, finished]]))
      .mockResolvedValueOnce(new Map([[CLIENT_KEY, { ...finished, files: [{ fileId: 7, name: 'Dune.epub', size: 4 }] }]]));

    await expect(adapter.status([CLIENT_KEY], config())).resolves.toEqual([expect.objectContaining({ state: 'queued' })]);
    await expect(adapter.status([CLIENT_KEY], config())).resolves.toEqual([expect.objectContaining({ state: 'completed', contentPath: null })]);
  });

  it('maps explicit TorBox errors to failed statuses', async () => {
    api.findByHashes.mockResolvedValue(
      new Map([
        [CLIENT_KEY, torrent({ state: 'error' })],
        [OTHER_KEY, torrent({ hash: OTHER_KEY, state: 'error' })],
      ]),
    );

    await expect(adapter.status([CLIENT_KEY, OTHER_KEY], config())).resolves.toEqual([
      expect.objectContaining({ clientKey: CLIENT_KEY, state: 'failed' }),
      expect.objectContaining({ clientKey: OTHER_KEY, state: 'failed' }),
    ]);
  });

  it('maps finished files to a staged path only when all files are present', async () => {
    const finished = torrent({ downloadFinished: true, progressPercent: 100, downloadedBytes: 100 });
    api.findByHashes.mockResolvedValue(new Map([[CLIENT_KEY, finished]]));

    await expect(adapter.status([CLIENT_KEY], config())).resolves.toEqual([
      expect.objectContaining({ clientKey: CLIENT_KEY, state: 'completed', contentPath: null }),
    ]);

    const directory = stagedClientDir(appDataPath, 'torbox', CLIENT_ID, CLIENT_KEY);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'Dune.epub'), Buffer.alloc(100));

    await expect(adapter.status([CLIENT_KEY], config())).resolves.toEqual([
      expect.objectContaining({ clientKey: CLIENT_KEY, state: 'completed', contentPath: directory }),
    ]);
  });

  it('isolates staging by client id so two clients holding one infohash do not share a directory', async () => {
    const finished = torrent({ downloadFinished: true, progressPercent: 100, downloadedBytes: 100 });
    api.findByHashes.mockResolvedValue(new Map([[CLIENT_KEY, finished]]));

    const directory = stagedClientDir(appDataPath, 'torbox', CLIENT_ID, CLIENT_KEY);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'Dune.epub'), Buffer.alloc(100));

    await expect(adapter.status([CLIENT_KEY], config())).resolves.toEqual([
      expect.objectContaining({ clientKey: CLIENT_KEY, contentPath: directory }),
    ]);
    await expect(adapter.status([CLIENT_KEY], config({ id: CLIENT_ID + 1 }))).resolves.toEqual([
      expect.objectContaining({ clientKey: CLIENT_KEY, contentPath: null }),
    ]);

    await adapter.remove(CLIENT_KEY, config({ id: CLIENT_ID + 1 }), { deleteFiles: true });
    await expect(readFile(join(directory, 'Dune.epub'))).resolves.toBeDefined();
  });

  it('still reads a release staged before staging was isolated by client id', async () => {
    const finished = torrent({ downloadFinished: true, progressPercent: 100, downloadedBytes: 100 });
    api.findByHashes.mockResolvedValue(new Map([[CLIENT_KEY, finished]]));

    const legacy = legacyStagedClientDir(appDataPath, 'torbox', CLIENT_KEY);
    await mkdir(legacy, { recursive: true });
    await writeFile(join(legacy, 'Dune.epub'), Buffer.alloc(100));

    await expect(adapter.status([CLIENT_KEY], config())).resolves.toEqual([
      expect.objectContaining({ clientKey: CLIENT_KEY, state: 'completed', contentPath: legacy }),
    ]);
  });

  it.each(['paused', 'metaDL', 'checkingResumeData'])('maps %s to queued', async (state) => {
    api.findByHashes.mockResolvedValue(new Map([[CLIENT_KEY, torrent({ state })]]));
    await expect(adapter.status([CLIENT_KEY], config())).resolves.toEqual([expect.objectContaining({ state: 'queued' })]);
  });

  it('maps ordinary and uploading states with seed information', async () => {
    api.findByHashes.mockResolvedValue(
      new Map([
        [CLIENT_KEY, torrent({ state: 'downloading' })],
        [OTHER_KEY, torrent({ hash: OTHER_KEY, state: 'uploading', downloadFinished: true, ratio: 1.25 })],
      ]),
    );

    await expect(adapter.status([CLIENT_KEY, OTHER_KEY], config())).resolves.toEqual([
      expect.objectContaining({ clientKey: CLIENT_KEY, state: 'downloading' }),
      expect.objectContaining({
        clientKey: OTHER_KEY,
        state: 'completed',
        seed: { seeding: true, ratio: 1.25, ratioGoal: null, seedingTimeSeconds: null, seedingTimeGoalMinutes: null, uploadedBytes: null },
      }),
    ]);
  });

  it('rejects staging a missing or unfinished torrent', async () => {
    await expect(adapter.stage(CLIENT_KEY, config())).rejects.toBeInstanceOf(BadRequestException);
    api.findByHashes.mockResolvedValue(new Map([[CLIENT_KEY, torrent()]]));
    await expect(adapter.stage(CLIENT_KEY, config())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('skips complete staged files without requesting download links', async () => {
    const directory = stagedClientDir(appDataPath, 'torbox', CLIENT_ID, CLIENT_KEY);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'Dune.epub'), Buffer.alloc(100));
    api.findByHashes.mockResolvedValue(new Map([[CLIENT_KEY, torrent({ downloadFinished: true })]]));

    await expect(adapter.stage(CLIENT_KEY, config())).resolves.toEqual({ contentPath: directory });
    expect(api.requestDownloadLink).not.toHaveBeenCalled();
  });

  it('keeps traversal-named files inside the staging directory', async () => {
    api.findByHashes.mockResolvedValue(
      new Map([[CLIENT_KEY, torrent({ downloadFinished: true, files: [{ fileId: 7, name: '../../escape.txt', size: 4 }] })]]),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(Buffer.from('safe'), { headers: { 'content-length': '4' } }))),
    );

    const result = await adapter.stage(CLIENT_KEY, config());
    const directory = stagedClientDir(appDataPath, 'torbox', CLIENT_ID, CLIENT_KEY);
    const target = resolve(directory, 'escape.txt');
    await expect(readFile(target, 'utf8')).resolves.toBe('safe');
    expect(target.startsWith(directory)).toBe(true);
    expect(result.contentPath).toBe(directory);
  });

  it('fetches file bytes and removes the partial file', async () => {
    api.findByHashes.mockResolvedValue(
      new Map([[CLIENT_KEY, torrent({ downloadFinished: true, files: [{ fileId: 7, name: 'book.epub', size: 4 }] })]]),
    );
    api.requestDownloadLink.mockResolvedValue('https://example.com/book.epub');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(Buffer.from('book'), { headers: { 'content-length': '4' } }))),
    );

    const directory = stagedClientDir(appDataPath, 'torbox', CLIENT_ID, CLIENT_KEY);
    await expect(adapter.stage(CLIENT_KEY, config())).resolves.toEqual({ contentPath: directory });
    await expect(readFile(join(directory, 'book.epub'), 'utf8')).resolves.toBe('book');
    await expect(stat(join(directory, 'book.epub.part'))).rejects.toThrow();
  });

  it('requests each file by the torrent file id the listing reported', async () => {
    api.findByHashes.mockResolvedValue(
      new Map([[CLIENT_KEY, torrent({ torrentId: 99, downloadFinished: true, files: [{ fileId: 7, name: 'book.epub', size: 4 }] })]]),
    );
    api.requestDownloadLink.mockResolvedValue('https://example.com/book.epub');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(Buffer.from('book'), { headers: { 'content-length': '4' } }))),
    );

    await adapter.stage(CLIENT_KEY, config());

    expect(api.requestDownloadLink).toHaveBeenCalledWith(config(), 99, 7);
  });

  it('refuses a download link that is not https', async () => {
    api.findByHashes.mockResolvedValue(
      new Map([[CLIENT_KEY, torrent({ downloadFinished: true, files: [{ fileId: 7, name: 'book.epub', size: 4 }] })]]),
    );
    api.requestDownloadLink.mockResolvedValue('http://example.com/book.epub');
    const fetchMock = vi.fn(() => Promise.resolve(new Response(Buffer.from('book'))));
    vi.stubGlobal('fetch', fetchMock);

    const directory = stagedClientDir(appDataPath, 'torbox', CLIENT_ID, CLIENT_KEY);
    await expect(adapter.stage(CLIENT_KEY, config())).rejects.toThrow('TorBox download links must use https');
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(stat(join(directory, 'book.epub.part'))).rejects.toThrow();
  });

  it('refuses a redirect that downgrades the download link to http', async () => {
    api.findByHashes.mockResolvedValue(
      new Map([[CLIENT_KEY, torrent({ downloadFinished: true, files: [{ fileId: 7, name: 'book.epub', size: 4 }] })]]),
    );
    api.requestDownloadLink.mockResolvedValue('https://example.com/book.epub');
    const fetchMock = vi.fn((input: URL | string) =>
      String(input) === 'https://example.com/book.epub'
        ? Promise.resolve(new Response(null, { status: 302, headers: { location: 'http://example.com/downgraded.epub' } }))
        : Promise.resolve(new Response(Buffer.from('book'), { headers: { 'content-length': '4' } })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const directory = stagedClientDir(appDataPath, 'torbox', CLIENT_ID, CLIENT_KEY);
    await expect(adapter.stage(CLIENT_KEY, config())).rejects.toThrow('TorBox download links must use https');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(stat(join(directory, 'book.epub.part'))).rejects.toThrow();
  });

  it('follows an https redirect to the file', async () => {
    api.findByHashes.mockResolvedValue(
      new Map([[CLIENT_KEY, torrent({ downloadFinished: true, files: [{ fileId: 7, name: 'book.epub', size: 4 }] })]]),
    );
    api.requestDownloadLink.mockResolvedValue('https://example.com/book.epub');
    vi.stubGlobal(
      'fetch',
      vi.fn((input: URL | string) =>
        String(input) === 'https://example.com/book.epub'
          ? Promise.resolve(new Response(null, { status: 302, headers: { location: 'https://example.com/final.epub' } }))
          : Promise.resolve(new Response(Buffer.from('book'), { headers: { 'content-length': '4' } })),
      ),
    );

    const directory = stagedClientDir(appDataPath, 'torbox', CLIENT_ID, CLIENT_KEY);
    await expect(adapter.stage(CLIENT_KEY, config())).resolves.toEqual({ contentPath: directory });
    await expect(readFile(join(directory, 'book.epub'), 'utf8')).resolves.toBe('book');
  });

  it('closes the CDN connection when TorBox answers with a web page', async () => {
    api.findByHashes.mockResolvedValue(
      new Map([[CLIENT_KEY, torrent({ downloadFinished: true, files: [{ fileId: 7, name: 'book.epub', size: 4 }] })]]),
    );
    api.requestDownloadLink.mockResolvedValue('https://example.com/book.epub');
    const tracked = trackedBody([new TextEncoder().encode('<html>login</html>')]);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(tracked.body, { headers: { 'content-type': 'text/html; charset=utf-8' } }))),
    );

    const directory = stagedClientDir(appDataPath, 'torbox', CLIENT_ID, CLIENT_KEY);
    await expect(adapter.stage(CLIENT_KEY, config())).rejects.toThrow('web page');
    await vi.waitFor(() => expect(tracked.wasCancelled()).toBe(true));
    await expect(stat(join(directory, 'book.epub.part'))).rejects.toThrow();
  });

  it('closes the CDN connection when a declared file is over the fetch ceiling', async () => {
    api.findByHashes.mockResolvedValue(
      new Map([[CLIENT_KEY, torrent({ downloadFinished: true, files: [{ fileId: 7, name: 'book.epub', size: 4 }] })]]),
    );
    api.requestDownloadLink.mockResolvedValue('https://example.com/book.epub');
    const tracked = trackedBody([new Uint8Array(4)]);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(tracked.body, { headers: { 'content-length': String(MAX_STAGE_BYTES + 1) } }))),
    );

    const directory = stagedClientDir(appDataPath, 'torbox', CLIENT_ID, CLIENT_KEY);
    await expect(adapter.stage(CLIENT_KEY, config())).rejects.toThrow('larger than the 8 GiB');
    await vi.waitFor(() => expect(tracked.wasCancelled()).toBe(true));
    await expect(stat(join(directory, 'book.epub.part'))).rejects.toThrow();
  });

  it('rejects a release whose listed size is over the staging ceiling before fetching anything', async () => {
    api.findByHashes.mockResolvedValue(
      new Map([
        [
          CLIENT_KEY,
          torrent({
            downloadFinished: true,
            totalBytes: MAX_STAGE_BYTES * 2,
            files: [
              { fileId: 7, name: 'part-one.m4b', size: MAX_STAGE_BYTES },
              { fileId: 8, name: 'part-two.m4b', size: MAX_STAGE_BYTES },
            ],
          }),
        ],
      ]),
    );

    await expect(adapter.stage(CLIENT_KEY, config())).rejects.toThrow('larger than the 8 GiB');
    expect(api.requestDownloadLink).not.toHaveBeenCalled();
    await expect(stat(stagedClientDir(appDataPath, 'torbox', CLIENT_ID, CLIENT_KEY))).rejects.toThrow();
  });

  it('refuses a release whose already-staged files exceed the ceiling', async () => {
    const directory = stagedClientDir(appDataPath, 'torbox', CLIENT_ID, CLIENT_KEY);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'Dune.epub'), '');
    await truncate(join(directory, 'Dune.epub'), MAX_STAGE_BYTES + 1);
    api.findByHashes.mockResolvedValue(
      new Map([[CLIENT_KEY, torrent({ downloadFinished: true, totalBytes: 0, files: [{ fileId: null, name: 'Dune.epub', size: null }] })]]),
    );

    await expect(adapter.stage(CLIENT_KEY, config())).rejects.toThrow('larger than the 8 GiB');
    expect(api.requestDownloadLink).not.toHaveBeenCalled();
  });

  it('stops staging once the release passes the ceiling while streaming', async () => {
    const directory = stagedClientDir(appDataPath, 'torbox', CLIENT_ID, CLIENT_KEY);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'Dune.epub'), '');
    await truncate(join(directory, 'Dune.epub'), MAX_STAGE_BYTES - 1);
    api.findByHashes.mockResolvedValue(
      new Map([
        [
          CLIENT_KEY,
          torrent({
            downloadFinished: true,
            files: [
              { fileId: null, name: 'Dune.epub', size: null },
              { fileId: 8, name: 'bonus.epub', size: 100 },
            ],
          }),
        ],
      ]),
    );
    api.requestDownloadLink.mockResolvedValue('https://example.com/bonus.epub');
    const tracked = trackedBody([new Uint8Array(100)]);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(tracked.body, { headers: { 'content-length': '100' } }))),
    );

    await expect(adapter.stage(CLIENT_KEY, config())).rejects.toBeInstanceOf(BadRequestException);
    await expect(stat(join(directory, 'bonus.epub.part'))).rejects.toThrow();
    await vi.waitFor(() => expect(tracked.wasCancelled()).toBe(true));
  });

  it('gives colliding sanitized names distinct targets instead of overwriting', async () => {
    api.findByHashes.mockResolvedValue(
      new Map([
        [
          CLIENT_KEY,
          torrent({
            downloadFinished: true,
            files: [
              { fileId: 7, name: 'Dune.epub', size: 4 },
              { fileId: 8, name: './Dune.epub', size: 4 },
            ],
          }),
        ],
      ]),
    );
    api.requestDownloadLink.mockResolvedValue('https://example.com/book.epub');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(Buffer.from('book'), { headers: { 'content-length': '4' } }))),
    );

    const directory = stagedClientDir(appDataPath, 'torbox', CLIENT_ID, CLIENT_KEY);
    await expect(adapter.stage(CLIENT_KEY, config())).resolves.toEqual({ contentPath: directory });
    await expect(readFile(join(directory, 'Dune.epub'), 'utf8')).resolves.toBe('book');
    await expect(readFile(join(directory, 'Dune (1).epub'), 'utf8')).resolves.toBe('book');
  });

  it('does not let a temp path overwrite a completed file with a .part name', async () => {
    api.findByHashes.mockResolvedValue(
      new Map([
        [
          CLIENT_KEY,
          torrent({
            downloadFinished: true,
            files: [
              { fileId: 7, name: 'book.epub.part', size: 4 },
              { fileId: 8, name: 'book.epub', size: 4 },
            ],
          }),
        ],
      ]),
    );
    api.requestDownloadLink.mockResolvedValue('https://example.com/book.epub');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(Buffer.from('book'), { headers: { 'content-length': '4' } }))),
    );

    const directory = stagedClientDir(appDataPath, 'torbox', CLIENT_ID, CLIENT_KEY);
    await expect(adapter.stage(CLIENT_KEY, config())).resolves.toEqual({ contentPath: directory });
    await expect(readFile(join(directory, 'book.epub.part'), 'utf8')).resolves.toBe('book');
    await expect(readFile(join(directory, 'book (1).epub'), 'utf8')).resolves.toBe('book');
  });

  it('leaves no partial file behind when a fetch fails mid-transfer', async () => {
    api.findByHashes.mockResolvedValue(
      new Map([[CLIENT_KEY, torrent({ downloadFinished: true, files: [{ fileId: 7, name: 'book.epub', size: 4 }] })]]),
    );
    api.requestDownloadLink.mockResolvedValue('https://example.com/book.epub');
    const broken = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('bo'));
        controller.error(new Error('connection reset'));
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(broken, { headers: { 'content-length': '4' } }))),
    );

    const directory = stagedClientDir(appDataPath, 'torbox', CLIENT_ID, CLIENT_KEY);
    await expect(adapter.stage(CLIENT_KEY, config())).rejects.toThrow('connection reset');
    await expect(stat(join(directory, 'book.epub.part'))).rejects.toThrow();
  });

  it('stops staging when the download is removed during setup', async () => {
    const lookup = deferred<Map<string, TorboxTorrent>>();
    let lookups = 0;
    api.findByHashes.mockImplementation(() => {
      lookups += 1;
      return lookups === 1 ? lookup.promise : Promise.resolve(new Map());
    });
    const fetchMock = vi.fn(() => Promise.resolve(new Response(Buffer.from('book'), { headers: { 'content-length': '4' } })));
    vi.stubGlobal('fetch', fetchMock);

    const staging = adapter.stage(CLIENT_KEY, config());
    await adapter.remove(CLIENT_KEY, config(), { deleteFiles: false });
    lookup.resolve(new Map([[CLIENT_KEY, torrent({ downloadFinished: true, files: [{ fileId: 7, name: 'book.epub', size: 4 }] })]]));

    await expect(staging).rejects.toThrow('The download was removed while it was being staged');
    expect(api.requestDownloadLink).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    api.findByHashes.mockResolvedValue(new Map([[CLIENT_KEY, torrent({ downloadFinished: true, progressPercent: 100, downloadedBytes: 100 })]]));
    await expect(adapter.status([CLIENT_KEY], config())).resolves.toEqual([
      expect.objectContaining({ clientKey: CLIENT_KEY, state: 'completed', contentPath: null }),
    ]);
  });

  it('stops staging when the download is removed between file operations', async () => {
    api.findByHashes.mockResolvedValue(
      new Map([[CLIENT_KEY, torrent({ downloadFinished: true, files: [{ fileId: 7, name: 'book.epub', size: 4 }] })]]),
    );
    const link = deferred<string>();
    let requestedLink = false;
    api.requestDownloadLink.mockImplementation(() => {
      requestedLink = true;
      return link.promise;
    });
    const fetchMock = vi.fn(() => Promise.resolve(new Response(Buffer.from('book'), { headers: { 'content-length': '4' } })));
    vi.stubGlobal('fetch', fetchMock);

    const staging = adapter.stage(CLIENT_KEY, config());
    await vi.waitFor(() => expect(requestedLink).toBe(true));
    await adapter.remove(CLIENT_KEY, config(), { deleteFiles: true });
    link.resolve('https://example.com/book.epub');

    await expect(staging).rejects.toThrow('The download was removed while it was being staged');
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(stat(stagedClientDir(appDataPath, 'torbox', CLIENT_ID, CLIENT_KEY))).rejects.toThrow();
  });

  it('keeps a newer staging job tracked after an older attempt is cancelled', async () => {
    api.findByHashes.mockResolvedValue(
      new Map([[CLIENT_KEY, torrent({ downloadFinished: true, files: [{ fileId: 7, name: 'book.epub', size: 4 }] })]]),
    );
    const fetchMock = vi.fn(() => Promise.resolve(new Response(Buffer.from('book'), { headers: { 'content-length': '4' } })));
    vi.stubGlobal('fetch', fetchMock);

    const firstLink = deferred<string>();
    api.requestDownloadLink.mockImplementationOnce(() => firstLink.promise);
    const first = adapter.stage(CLIENT_KEY, config());
    await vi.waitFor(() => expect(api.requestDownloadLink).toHaveBeenCalledTimes(1));

    // Cancelling drops the first job from the map while its stage() is still parked on the link.
    await adapter.remove(CLIENT_KEY, config(), { deleteFiles: false });

    // A fresh attempt claims the same key before the cancelled one has unwound.
    const secondLink = deferred<string>();
    api.requestDownloadLink.mockImplementation(() => secondLink.promise);
    const second = adapter.stage(CLIENT_KEY, config());
    await vi.waitFor(() => expect(api.requestDownloadLink).toHaveBeenCalledTimes(2));

    firstLink.resolve('https://example.com/book.epub');
    await expect(first).rejects.toThrow('The download was removed while it was being staged');

    // The first attempt's cleanup must not have dropped the second job: status still reports staging.
    await expect(adapter.status([CLIENT_KEY], config())).resolves.toEqual([expect.objectContaining({ state: 'downloading' })]);

    secondLink.resolve('https://example.com/book.epub');
    await expect(second).resolves.toEqual({ contentPath: stagedClientDir(appDataPath, 'torbox', CLIENT_ID, CLIENT_KEY) });
  });

  it('waits for an in-flight transfer to stop before deleting its files', async () => {
    api.findByHashes.mockResolvedValue(
      new Map([[CLIENT_KEY, torrent({ downloadFinished: true, files: [{ fileId: 7, name: 'book.epub', size: 100 }] })]]),
    );
    api.requestDownloadLink.mockResolvedValue('https://example.com/book.epub');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('book'));
      },
    });
    const fetchMock = vi.fn(() => Promise.resolve(new Response(body, { headers: { 'content-length': '100' } })));
    vi.stubGlobal('fetch', fetchMock);

    const staging = adapter.stage(CLIENT_KEY, config());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    void staging.catch(() => undefined);

    await adapter.remove(CLIENT_KEY, config(), { deleteFiles: true });

    await expect(staging).rejects.toThrow('The download was removed while it was being staged');
    await expect(stat(stagedClientDir(appDataPath, 'torbox', CLIENT_ID, CLIENT_KEY))).rejects.toThrow();
  });

  it('deletes the remote torrent and optionally its staged files', async () => {
    api.findByHashes.mockResolvedValue(new Map([[CLIENT_KEY, torrent()]]));
    const directory = stagedClientDir(appDataPath, 'torbox', CLIENT_ID, CLIENT_KEY);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'book.epub'), 'book');

    await adapter.remove(CLIENT_KEY, config(), { deleteFiles: true });
    expect(api.controlTorrent).toHaveBeenCalledWith(config(), 42, 'delete');
    await expect(stat(directory)).rejects.toThrow();
  });

  /**
   * The callers that swallow a TorBox refusal settle the attempt anyway, so this is the last
   * moment anyone looks for the staged files: leaving them behind strands a whole release.
   */
  it('still deletes its staged files when the remote lookup fails', async () => {
    api.findByHashes.mockRejectedValue(new Error('torbox is down'));
    const directory = stagedClientDir(appDataPath, 'torbox', CLIENT_ID, CLIENT_KEY);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'book.epub'), 'book');

    await expect(adapter.remove(CLIENT_KEY, config(), { deleteFiles: true })).rejects.toThrow('torbox is down');
    await expect(stat(directory)).rejects.toThrow();
  });

  it('still deletes its staged files when the remote delete fails', async () => {
    api.findByHashes.mockResolvedValue(new Map([[CLIENT_KEY, torrent()]]));
    api.controlTorrent.mockRejectedValue(new Error('rate limited'));
    const directory = stagedClientDir(appDataPath, 'torbox', CLIENT_ID, CLIENT_KEY);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'book.epub'), 'book');

    await expect(adapter.remove(CLIENT_KEY, config(), { deleteFiles: true })).rejects.toThrow('rate limited');
    await expect(stat(directory)).rejects.toThrow();
  });

  it('keeps its staged files after a remote failure when the operator did not ask for their removal', async () => {
    api.findByHashes.mockRejectedValue(new Error('torbox is down'));
    const directory = stagedClientDir(appDataPath, 'torbox', CLIENT_ID, CLIENT_KEY);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'book.epub'), 'book');

    await expect(adapter.remove(CLIENT_KEY, config(), { deleteFiles: false })).rejects.toThrow('torbox is down');
    await expect(stat(directory)).resolves.toBeTruthy();
  });

  it('reports the TorBox user email during connection tests', async () => {
    await expect(adapter.test(config())).resolves.toEqual({ success: true, version: 'reader@example.com' });
    api.getUser.mockRejectedValue(new Error('connection refused'));
    await expect(adapter.test(config())).resolves.toEqual({ success: false, error: 'connection refused' });
  });

  it('reports unsupported ownership listing', async () => {
    await expect(adapter.listOwned(config())).resolves.toEqual({ supported: false, truncated: false, items: [] });
  });

  it('sends magnet creation requests with allow_zip disabled', async () => {
    let submitted: FormData | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: URL | string, init: RequestInit = {}) => {
        submitted = init.body as FormData;
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: { torrent_id: 42, hash: CLIENT_KEY } })));
      }),
    );

    await expect(new TorboxApiClient().createTorrent(config(), { magnet: 'magnet:?xt=urn:btih:' + CLIENT_KEY })).resolves.toEqual({
      torrentId: 42,
      hash: CLIENT_KEY,
    });
    expect(submitted?.get('magnet')).toBe('magnet:?xt=urn:btih:' + CLIENT_KEY);
    expect(submitted?.get('allow_zip')).toBe('false');
  });
});
