import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
import { stagedClientDir } from '../download-client-adapter';
import { TorboxAdapter } from './torbox.adapter';
import { TorboxApiClient } from './torbox.api';
import type { TorboxTorrent } from './torbox.api';

const CLIENT_KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);

function config(overrides: Partial<ResolvedClientConfig> = {}): ResolvedClientConfig {
  return {
    id: 9,
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

  it('maps missing downloads and API errors to failed statuses', async () => {
    api.findByHashes.mockResolvedValue(
      new Map([
        [CLIENT_KEY, torrent({ downloadPresent: false })],
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

    const directory = stagedClientDir(appDataPath, 'torbox', CLIENT_KEY);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'Dune.epub'), Buffer.alloc(100));

    await expect(adapter.status([CLIENT_KEY], config())).resolves.toEqual([
      expect.objectContaining({ clientKey: CLIENT_KEY, state: 'completed', contentPath: directory }),
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
    const directory = stagedClientDir(appDataPath, 'torbox', CLIENT_KEY);
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
    const directory = stagedClientDir(appDataPath, 'torbox', CLIENT_KEY);
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

    const directory = stagedClientDir(appDataPath, 'torbox', CLIENT_KEY);
    await expect(adapter.stage(CLIENT_KEY, config())).resolves.toEqual({ contentPath: directory });
    await expect(readFile(join(directory, 'book.epub'), 'utf8')).resolves.toBe('book');
    await expect(stat(join(directory, 'book.epub.part'))).rejects.toThrow();
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

    const directory = stagedClientDir(appDataPath, 'torbox', CLIENT_KEY);
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

    const directory = stagedClientDir(appDataPath, 'torbox', CLIENT_KEY);
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

    const directory = stagedClientDir(appDataPath, 'torbox', CLIENT_KEY);
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
    await expect(stat(stagedClientDir(appDataPath, 'torbox', CLIENT_KEY))).rejects.toThrow();
  });

  it('deletes the remote torrent and optionally its staged files', async () => {
    api.findByHashes.mockResolvedValue(new Map([[CLIENT_KEY, torrent()]]));
    const directory = stagedClientDir(appDataPath, 'torbox', CLIENT_KEY);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'book.epub'), 'book');

    await adapter.remove(CLIENT_KEY, config(), { deleteFiles: true });
    expect(api.controlTorrent).toHaveBeenCalledWith(config(), 42, 'delete');
    await expect(stat(directory)).rejects.toThrow();
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
