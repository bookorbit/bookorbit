import { Logger } from '@nestjs/common';

import { DuckDuckGoCoverProvider } from './duckduckgo-cover-provider';

function result(sourceUrl: string, width: number, height: number) {
  return {
    sourceUrl,
    url: sourceUrl,
    previewUrl: `${sourceUrl}/thumb`,
    width,
    height,
    source: 'Web',
  };
}

describe('DuckDuckGoCoverProvider', () => {
  const originalFetch = global.fetch;
  const loggerWarn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const loggerError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  let fetchMock: ReturnType<typeof vi.fn>;
  let provider: DuckDuckGoCoverProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new DuckDuckGoCoverProvider();
    fetchMock = vi.fn();
    global.fetch = fetchMock as never;
  });

  afterAll(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('combines site/general/fallback results with deduplication', async () => {
    const performSearch = vi.spyOn(provider as any, 'performSearch');
    performSearch
      .mockResolvedValueOnce([result('https://img/a', 500, 800), result('https://img/ignored-small', 200, 300)])
      .mockResolvedValueOnce([result('https://img/a', 500, 800), result('https://img/b', 520, 900)])
      .mockResolvedValueOnce([result('https://img/c', 530, 930)]);

    const results = await provider.search({ title: 'Dune', author: 'Frank Herbert' });

    expect(performSearch).toHaveBeenNthCalledWith(
      1,
      'Dune Frank Herbert book (site:amazon.com OR site:goodreads.com)',
      expect.stringContaining('Tall'),
    );
    expect(performSearch).toHaveBeenNthCalledWith(2, 'Dune Frank Herbert book', expect.stringContaining('Tall'));
    expect(performSearch).toHaveBeenNthCalledWith(3, 'Dune book', expect.stringContaining('Tall'));
    expect(results.map((entry) => entry.sourceUrl)).toEqual(['https://img/a', 'https://img/b', 'https://img/c']);
  });

  it('filters audiobook results to near-square dimensions', async () => {
    const performSearch = vi.spyOn(provider as any, 'performSearch');
    performSearch.mockResolvedValueOnce([result('https://img/square', 500, 500), result('https://img/tall', 500, 800)]).mockResolvedValueOnce([]);

    const results = await provider.search({ title: 'Dune', isAudiobook: true });

    expect(results.map((entry) => entry.sourceUrl)).toEqual(['https://img/square']);
  });

  it('returns an empty list when internal search errors with a non-Error value', async () => {
    vi.spyOn(provider as any, 'performSearch').mockRejectedValueOnce(null);

    await expect(provider.search({ title: 'Dune' })).resolves.toEqual([]);
    expect(loggerError).toHaveBeenCalledWith('Error searching DuckDuckGo: null', undefined);
  });

  it('returns no results when the initial search page request fails', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));

    await expect((provider as any).performSearch('query', '&iar=images')).resolves.toEqual([]);
    expect(loggerWarn).toHaveBeenCalledWith('Search page fetch failed: 500');
  });

  it('returns no results when vqd token is missing from html', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>no token</html>', { status: 200 }));

    await expect((provider as any).performSearch('query', '&iar=images')).resolves.toEqual([]);
    expect(loggerWarn).toHaveBeenCalledWith('Could not find vqd token');
  });

  it('returns no results when the JSON API request fails', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('<html>vqd="123-456"</html>', { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 403 }));

    await expect((provider as any).performSearch('query', '&iar=images')).resolves.toEqual([]);
    expect(loggerWarn).toHaveBeenCalledWith('API fetch failed: 403');
  });

  it('maps JSON API results and infers source labels', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>vqd="123-456"</html>', { status: 200 })).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            { image: 'https://cdn.amazon.com/a.jpg', thumbnail: 'https://cdn.amazon.com/a_t.jpg', width: 700, height: 1000 },
            { image: 'https://www.goodreads.com/b.jpg', thumbnail: 'https://www.goodreads.com/b_t.jpg', width: 650, height: 920 },
            { image: 'https://images.google.com/c.jpg', thumbnail: 'https://images.google.com/c_t.jpg', width: 600, height: 900 },
            { image: 'not-a-valid-url', thumbnail: 'https://x.test/t.jpg', width: 500, height: 800 },
          ],
        }),
        { status: 200 },
      ),
    );

    const results = await (provider as any).performSearch('query', '&iar=images');

    expect(results).toEqual([
      expect.objectContaining({ sourceUrl: 'https://cdn.amazon.com/a.jpg', source: 'Amazon' }),
      expect.objectContaining({ sourceUrl: 'https://www.goodreads.com/b.jpg', source: 'Goodreads' }),
      expect.objectContaining({ sourceUrl: 'https://images.google.com/c.jpg', source: 'Google' }),
      expect.objectContaining({ sourceUrl: 'not-a-valid-url', source: 'Web' }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
