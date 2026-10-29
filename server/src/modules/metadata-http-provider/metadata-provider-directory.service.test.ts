import { Logger } from '@nestjs/common';

import { BUNDLED_PROVIDER_DIRECTORY } from './metadata-provider-directory';
import { MetadataProviderDirectoryService } from './metadata-provider-directory.service';

const safeFetch = vi.hoisted(() => vi.fn<(url: string, init?: RequestInit) => Promise<Response>>());
vi.mock('../../common/utils/safe-fetch', () => ({ safeFetch }));

const URL_ = 'https://raw.githubusercontent.com/bookorbit/bookorbit-metadata-providers/main/directory.json';
const REMOTE = {
  providers: [
    {
      key: 'newsource',
      name: 'New Source',
      summary: 'Published after this release.',
      image: 'ghcr.io/bookorbit/newsource-provider',
      version: '0.2.0',
      docsUrl: 'https://github.com/bookorbit/bookorbit-metadata-providers/tree/main/providers/newsource',
    },
  ],
};

function service(url: string | null = URL_) {
  return new MetadataProviderDirectoryService({ metadataProviderDirectoryUrl: url } as never);
}

describe('MetadataProviderDirectoryService', () => {
  beforeEach(() => {
    safeFetch.mockReset();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('serves the online list, read once for callers that arrive together', async () => {
    safeFetch.mockResolvedValue(Response.json(REMOTE));
    const directory = service();

    const [first, second] = await Promise.all([directory.get(), directory.get()]);

    expect(first).toMatchObject({ source: 'remote', providers: [{ key: 'newsource', port: 8080 }] });
    expect(first.fetchedAt).toEqual(expect.any(String));
    expect(second).toEqual(first);
    expect(safeFetch).toHaveBeenCalledTimes(1);
    expect(safeFetch).toHaveBeenCalledWith(URL_, expect.objectContaining({ redirect: 'manual' }));
  });

  it('never contacts GitHub when the online list is turned off', async () => {
    await expect(service(null).get()).resolves.toEqual({ providers: [...BUNDLED_PROVIDER_DIRECTORY], source: 'bundled', fetchedAt: null });
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it('falls back to the bundled list, and waits before asking again', async () => {
    vi.useFakeTimers();
    safeFetch.mockResolvedValue(new Response('gone', { status: 404 }));
    const directory = service();

    await expect(directory.get()).resolves.toMatchObject({ source: 'bundled' });
    await directory.get();
    expect(safeFetch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(15 * 60 * 1000);
    safeFetch.mockResolvedValue(Response.json(REMOTE));
    await expect(directory.get()).resolves.toMatchObject({ source: 'remote' });
  });

  it('keeps the last good list when a later read fails', async () => {
    vi.useFakeTimers();
    safeFetch.mockResolvedValueOnce(Response.json(REMOTE));
    const directory = service();
    await directory.get();

    vi.advanceTimersByTime(25 * 60 * 60 * 1000);
    safeFetch.mockResolvedValueOnce(new Response('{"providers": [', { status: 200 }));

    await expect(directory.get()).resolves.toMatchObject({ source: 'remote', providers: [{ key: 'newsource' }] });
    expect(safeFetch).toHaveBeenCalledTimes(2);
  });

  it('refuses an oversized document and a redirect away from https', async () => {
    safeFetch.mockResolvedValueOnce(new Response('x'.repeat(300 * 1024), { status: 200 }));
    await expect(service().get()).resolves.toMatchObject({ source: 'bundled' });

    safeFetch.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://example.com/directory.json' } }));
    await expect(service().get()).resolves.toMatchObject({ source: 'bundled' });
    expect(safeFetch).toHaveBeenCalledTimes(2);
  });
});
