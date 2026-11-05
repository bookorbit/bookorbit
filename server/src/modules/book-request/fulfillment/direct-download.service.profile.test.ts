import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The profile handoff is a contract on `safeFetch`'s third argument, not on the fetch itself, so
 * this file pins the two modules the service talks to and asserts what it passes along. `safeFetch`
 * turning a `proxyUrl` into an undici ProxyAgent is covered by its own suite.
 */
const { safeFetchMock, ensureSafeUrlMock } = vi.hoisted(() => ({
  safeFetchMock: vi.fn(),
  ensureSafeUrlMock: vi.fn((url: string) => Promise.resolve(new URL(url))),
}));

vi.mock('../../../common/utils/safe-fetch', () => ({ safeFetch: safeFetchMock }));
vi.mock('../../../common/utils/ssrf.utils', () => ({ ensureSafeUrl: ensureSafeUrlMock }));

import { DirectDownloadService } from './direct-download.service';
import type { BookRequestDownloadRow } from '../../../db/schema';

const HASH = 'b'.repeat(40);
const SETTLE_MS = 5_000;

function epubResponse(body = 'book'): Response {
  return new Response(body, { headers: { 'content-type': 'application/epub+zip', 'content-length': String(body.length) } });
}

describe('DirectDownloadService network profile', () => {
  let appDataPath: string;
  let service: DirectDownloadService;
  let downloads: { update: ReturnType<typeof vi.fn> };
  let indexers: { resolveConfig: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    appDataPath = await mkdtemp(join(tmpdir(), 'bookorbit-profile-'));
    downloads = { update: vi.fn().mockResolvedValue(undefined) };
    indexers = { resolveConfig: vi.fn() };
    service = new DirectDownloadService({ appDataPath } as never, downloads as never, indexers as never);
    safeFetchMock.mockReset();
    safeFetchMock.mockResolvedValue(epubResponse());
    ensureSafeUrlMock.mockClear();
  });

  afterEach(async () => {
    vi.clearAllMocks();
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

  it('routes a new direct file through the proxy its source is configured with', async () => {
    indexers.resolveConfig.mockResolvedValue({ networkProfile: { proxyUrl: 'http://proxy:8888' } });

    await service.add({ downloadId: 1, indexerId: 5, fileUrl: 'https://example.com/book.epub', fileName: 'book.epub', clientKey: HASH });
    await settle();

    expect(indexers.resolveConfig).toHaveBeenCalledWith(5);
    expect(safeFetchMock).toHaveBeenCalledWith(
      'https://example.com/book.epub',
      expect.anything(),
      expect.objectContaining({ allowPrivate: false, profile: { proxyUrl: 'http://proxy:8888' }, pinResolvedAddress: true }),
    );
  });

  it('resumes a direct file through the profile its source still carries', async () => {
    const directory = join(appDataPath, 'request-downloads', HASH);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'book.epub'), 'partial');
    indexers.resolveConfig.mockResolvedValue({ networkProfile: { proxyUrl: 'http://proxy:8888' } });
    safeFetchMock.mockResolvedValue(
      new Response(' tail', {
        status: 206,
        headers: { 'content-type': 'application/epub+zip', 'content-range': 'bytes 7-11/12', etag: '"edition-1"' },
      }),
    );

    const resumed = await service.resume({
      id: 9,
      source: 'direct_url',
      clientKey: HASH,
      indexerId: 5,
      directUrl: 'https://example.com/book.epub',
      directFileName: 'book.epub',
      directEtag: '"edition-1"',
      directLastModified: null,
      totalBytes: 12,
      status: 'downloading',
    } as BookRequestDownloadRow);

    expect(resumed).toBe(true);
    await settle();
    expect(indexers.resolveConfig).toHaveBeenCalledWith(5);
    expect(safeFetchMock).toHaveBeenCalledWith(
      'https://example.com/book.epub',
      expect.anything(),
      expect.objectContaining({ profile: { proxyUrl: 'http://proxy:8888' } }),
    );
  });

  it('fails rather than resuming on default egress when the source was deleted', async () => {
    const resumed = await service.resume({
      id: 10,
      source: 'direct_url',
      clientKey: HASH,
      indexerId: null,
      directUrl: 'https://example.com/book.epub',
      directFileName: 'book.epub',
      directEtag: '"edition-1"',
      directLastModified: null,
      totalBytes: 12,
      status: 'downloading',
    } as BookRequestDownloadRow);

    expect(resumed).toBe(false);
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it('fails rather than resuming on default egress when the source no longer resolves', async () => {
    indexers.resolveConfig.mockRejectedValue(new Error('not found'));

    const resumed = await service.resume({
      id: 11,
      source: 'direct_url',
      clientKey: HASH,
      indexerId: 5,
      directUrl: 'https://example.com/book.epub',
      directFileName: 'book.epub',
      directEtag: '"edition-1"',
      directLastModified: null,
      totalBytes: 12,
      status: 'downloading',
    } as BookRequestDownloadRow);

    expect(resumed).toBe(false);
    expect(safeFetchMock).not.toHaveBeenCalled();
  });
});
