import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The file's host has to pass the public-address policy before anything is fetched, so it answers
 * with a public address here. Nothing in these cases may connect to that address: the file is
 * served by the local proxy, and a download that skipped the proxy would fail on it instead.
 */
vi.mock('dns/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('dns/promises')>();
  return {
    ...actual,
    lookup: vi.fn(async (hostname: string, options: unknown) =>
      hostname === 'files.example.com' ? [{ address: '203.0.113.10', family: 4 }] : actual.lookup(hostname, options as never),
    ),
  };
});

import { forgetDispatchers } from '../../../common/utils/safe-fetch';
import type { BookRequestDownloadRow } from '../../../db/schema';
import { DirectDownloadService } from './direct-download.service';

const HASH = 'b'.repeat(40);
const SETTLE_MS = 5_000;
const FILE_URL = 'http://files.example.com/book.epub';

/**
 * Real requests through a real local HTTP proxy, with nothing in undici mocked: what is under test
 * is that the source's network profile decides which way the file actually travels.
 */
describe('DirectDownloadService with a source network profile', () => {
  let appDataPath: string;
  let proxy: Server;
  let proxyUrl: string;
  let seenByProxy: Array<{ url: string; range: string | undefined }>;
  let answer: (request: IncomingMessage, response: ServerResponse) => void;
  let indexers: { resolveNetworkProfile: ReturnType<typeof vi.fn> };
  let service: DirectDownloadService;

  beforeEach(async () => {
    appDataPath = await mkdtemp(join(tmpdir(), 'bookorbit-proxy-'));
    seenByProxy = [];
    answer = (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/epub+zip' });
      response.end('through the proxy');
    };
    proxy = createServer((request, response) => {
      seenByProxy.push({ url: request.url ?? '', range: request.headers.range });
      answer(request, response);
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;

    indexers = { resolveNetworkProfile: vi.fn().mockResolvedValue({ proxyUrl }) };
    const downloads = { update: vi.fn().mockResolvedValue(undefined) };
    service = new DirectDownloadService({ appDataPath } as never, downloads as never, indexers as never);
  });

  afterEach(async () => {
    forgetDispatchers();
    await new Promise((resolve) => proxy.close(resolve));
    await rm(appDataPath, { recursive: true, force: true });
  });

  async function settle() {
    return vi.waitFor(
      async () => {
        const [status] = await service.status([HASH]);
        expect(status.state === 'completed' || status.state === 'failed').toBe(true);
        return status;
      },
      { timeout: SETTLE_MS },
    );
  }

  it('downloads the file through the proxy of the source it came from', async () => {
    await service.add({ downloadId: 1, fileUrl: FILE_URL, fileName: 'book.epub', clientKey: HASH, indexerId: 4 });
    const status = await settle();

    expect(status.state).toBe('completed');
    await expect(readFile(status.contentPath!, 'utf8')).resolves.toBe('through the proxy');
    expect(seenByProxy.map((request) => request.url)).toEqual([FILE_URL]);
    expect(indexers.resolveNetworkProfile).toHaveBeenCalledWith(4);
  });

  /** The point of sending a source through a proxy: with the proxy gone, nothing leaves another way. */
  it('fails the download rather than going direct when the proxy is down', async () => {
    await new Promise((resolve) => proxy.close(resolve));
    proxy = createServer();

    await service.add({ downloadId: 1, fileUrl: FILE_URL, fileName: 'book.epub', clientKey: HASH, indexerId: 4 });
    const status = await settle();

    expect(status.state).toBe('failed');
    expect(status.contentPath).toBeNull();
  });

  it('resumes an interrupted download through the same proxy', async () => {
    const directory = join(appDataPath, 'request-downloads', HASH);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'book.epub'), 'partial');
    answer = (_request, response) => {
      response.writeHead(206, { 'content-type': 'application/epub+zip', 'content-range': 'bytes 7-11/12', etag: '"edition-1"' });
      response.end(' tail');
    };

    const resumed = await service.resume({
      id: 44,
      source: 'direct_url',
      clientKey: HASH,
      directUrl: FILE_URL,
      directFileName: 'book.epub',
      directEtag: '"edition-1"',
      directLastModified: null,
      totalBytes: 12,
      status: 'downloading',
      indexerId: 4,
    } as BookRequestDownloadRow);

    expect(resumed).toBe(true);
    expect((await settle()).state).toBe('completed');
    await expect(readFile(join(directory, 'book.epub'), 'utf8')).resolves.toBe('partial tail');
    expect(seenByProxy).toEqual([{ url: FILE_URL, range: 'bytes=7-' }]);
  });
});
