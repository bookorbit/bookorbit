import { ProviderConfigurations } from '@bookorbit/types';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { ProviderThrottleError } from '../../provider-throttle.error';
import { GoodreadsProvider } from './goodreads.provider';

describe('GoodreadsProvider', () => {
  let provider: GoodreadsProvider;
  let providerConfig: ProviderConfigService;

  const mockConfig: ProviderConfigurations = {
    google: { enabled: true, apiKey: '' },
    amazon: { enabled: true, domain: 'amazon.com', cookie: '' },
    goodreads: { enabled: true },
    hardcover: { enabled: false, apiKey: '' },
    openLibrary: { enabled: true },
    itunes: { enabled: true, coverResolution: 'high' },
    audible: { enabled: false, domain: 'com' },
    audnexus: { enabled: false },
    comicvine: { enabled: false, apiKey: '' },
    ranobedb: { enabled: false },
    kobo: { enabled: false, country: 'us', language: 'en' },
    lubimyczytac: { enabled: false },
  };

  function goodreadsBookHtml(bookId: string, title: string): string {
    const mockState = {
      [`Book:kca:${bookId}`]: { title },
    };
    return `<script id="__NEXT_DATA__">{"props":{"pageProps":{"apolloState":${JSON.stringify(mockState)}}}}</script>`;
  }

  function fetchUrl(input: unknown): string {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.toString();
    if (typeof input === 'object' && input !== null && 'url' in input && typeof input.url === 'string') return input.url;
    return '';
  }

  beforeEach(() => {
    providerConfig = {
      getConfig: vi.fn().mockResolvedValue(mockConfig),
    } as unknown as ProviderConfigService;
    provider = new GoodreadsProvider(providerConfig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('search', () => {
    it('should return empty array if disabled', async () => {
      vi.spyOn(providerConfig, 'getConfig').mockResolvedValue({
        ...mockConfig,
        goodreads: { enabled: false },
      });

      const result = await provider.search({ title: 'Test' });
      expect(result).toEqual([]);
    });

    it('should search by title/author and fetch book details', async () => {
      const autocomplete = [{ bookId: '123', bookUrl: '/book/show/123.Some_Book', title: 'Some Book' }];
      // Mock book HTML with __NEXT_DATA__
      const mockState = {
        'Book:kca:123': { title: 'Some Book' },
      };
      const bookHtml = `
        <script id="__NEXT_DATA__" type="application/json">
          {"props": {"pageProps": {"apolloState": ${JSON.stringify(mockState)}}}}
        </script>
      `;

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(autocomplete) })
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(bookHtml) });

      const result = await provider.search({ title: 'Some Book' });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://www.goodreads.com/book/auto_complete?format=json&q=Some%20Book'),
        expect.any(Object),
      );
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('https://www.goodreads.com/book/show/123'), expect.any(Object));
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Some Book');
    });

    it('should find by ISBN and fetch book details', async () => {
      const isbnHtml = `
        <meta property="og:url" content="https://www.goodreads.com/book/show/456.Test_ISBN">
      `;
      const mockState = {
        'Book:kca:456': { title: 'Test ISBN Book' },
      };
      const bookHtml = `
        <script id="__NEXT_DATA__" type="application/json">
          {"props": {"pageProps": {"apolloState": ${JSON.stringify(mockState)}}}}
        </script>
      `;

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(isbnHtml) })
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(bookHtml) });

      const result = await provider.search({ isbn: '1234567890' });

      expect(global.fetch).toHaveBeenCalledWith('https://www.goodreads.com/book/isbn/1234567890', expect.any(Object));
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Test ISBN Book');
    });

    it('should return empty array if ISBN lookup does not find a book ID', async () => {
      const emptyHtml = `<html><body>No ISBN found</body></html>`;
      global.fetch = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(emptyHtml) });

      const result = await provider.search({ isbn: '0000000000' });
      expect(result).toEqual([]);
    });

    it('should handle sleep between requests', async () => {
      const BETWEEN_REQUESTS_MS = 600;
      vi.useFakeTimers();
      const autocomplete = [
        { bookId: '1', bookUrl: '/book/show/1.B1', title: 'B1' },
        { bookId: '2', bookUrl: '/book/show/2.B2', title: 'B2' },
      ];
      const mockState1 = { 'Book:kca:1': { title: 'B1' } };
      const mockState2 = { 'Book:kca:2': { title: 'B2' } };
      const bookHtml1 = `<script id="__NEXT_DATA__">{"props":{"pageProps":{"apolloState":${JSON.stringify(mockState1)}}}}</script>`;
      const bookHtml2 = `<script id="__NEXT_DATA__">{"props":{"pageProps":{"apolloState":${JSON.stringify(mockState2)}}}}</script>`;

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(autocomplete) })
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(bookHtml1) })
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(bookHtml2) });

      const searchPromise = provider.search({ title: 'Test' });

      // Search IDs
      await vi.advanceTimersByTimeAsync(0);
      // First book fetch
      await vi.advanceTimersByTimeAsync(0);
      // Wait for sleep
      await vi.advanceTimersByTimeAsync(BETWEEN_REQUESTS_MS);
      // Second book fetch
      await vi.advanceTimersByTimeAsync(0);

      const result = await searchPromise;
      expect(result).toHaveLength(2);
    });

    it('should handle fetch failure', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      const result = await provider.search({ title: 'Test' });
      expect(result).toEqual([]);
    });

    it('should rethrow provider throttle errors', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 429,
        headers: { get: vi.fn().mockReturnValue('120') },
      });

      await expect(provider.search({ title: 'Test' })).rejects.toBeInstanceOf(ProviderThrottleError);
    });

    it('should use title-based scoring in autocomplete results', async () => {
      const BETWEEN_REQUESTS_MS = 600;
      vi.useFakeTimers();
      const autocomplete = [
        { bookId: '1', bookUrl: '/book/show/1.The_Great_Gatsby', title: 'The Great Gatsby' },
        { bookId: '2', bookUrl: '/book/show/2.Something_Else', title: 'Something Else' },
        { bookId: '3', bookUrl: '/book/show/3.Gatsby_Study_Guide', title: 'Gatsby Study Guide' },
        { bookId: '4', bookUrl: '/book/show/4.The_Great_Gatsby_Special', title: 'The Great Gatsby Special' },
      ];
      // limit is 3, so B2 should be dropped if it has lower score
      const mockState = { 'Book:kca:1': { title: 'B' } };
      const bookHtml = `<script id="__NEXT_DATA__">{"props":{"pageProps":{"apolloState":${JSON.stringify(mockState)}}}}</script>`;

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(autocomplete) })
        .mockResolvedValue({ ok: true, text: () => Promise.resolve(bookHtml) });

      const searchPromise = provider.search({ title: 'The Great Gatsby' });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(BETWEEN_REQUESTS_MS);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(BETWEEN_REQUESTS_MS);
      await vi.advanceTimersByTimeAsync(0);
      await searchPromise;
      expect(global.fetch).toHaveBeenCalledTimes(4); // 1 autocomplete + 3 book lookups
    });

    it('prefers title-only autocomplete matches over author-query summary results', async () => {
      vi.useFakeTimers();
      const titleOnly = [
        {
          bookId: '56916837',
          bookUrl: '/book/show/56916837-to-kill-a-mockingbird',
          title: 'To Kill a Mockingbird',
          bookTitleBare: 'To Kill a Mockingbird',
          author: 'Harper Lee',
          ratingsCount: 7_000_000,
        },
      ];
      const titleWithAuthor = [
        {
          bookId: '26189532',
          bookUrl: '/book/show/26189532-to-kill-a-mockingbird-by-harper-lee-summary-analysis',
          title: 'To Kill a Mockingbird by Harper Lee | Summary & Analysis',
          bookTitleBare: 'To Kill a Mockingbird by Harper Lee | Summary & Analysis',
          author: 'aBookaDay',
          ratingsCount: 100,
        },
      ];

      global.fetch = vi.fn((input: Parameters<typeof fetch>[0]) => {
        const url = fetchUrl(input);
        if (url.includes('q=To%20Kill%20a%20Mockingbird%20Harper%20Lee')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(titleWithAuthor) });
        }
        if (url.includes('q=To%20Kill%20a%20Mockingbird')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(titleOnly) });
        }
        if (url.includes('/book/show/56916837')) {
          return Promise.resolve({ ok: true, text: () => Promise.resolve(goodreadsBookHtml('56916837', 'To Kill a Mockingbird')) });
        }
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(goodreadsBookHtml('26189532', 'To Kill a Mockingbird by Harper Lee | Summary & Analysis')),
        });
      }) as never;

      const searchPromise = provider.search({ title: 'To Kill a Mockingbird', author: 'Harper Lee' });
      await vi.runAllTimersAsync();
      const result = await searchPromise;

      const bookFetchUrls = vi
        .mocked(global.fetch)
        .mock.calls.map(([url]) => fetchUrl(url))
        .filter((url) => url.includes('/book/show/'));
      expect(bookFetchUrls[0]).toBe('https://www.goodreads.com/book/show/56916837');
      expect(result[0].title).toBe('To Kill a Mockingbird');
    });

    it('ranks exact title and author autocomplete matches above companion books', async () => {
      vi.useFakeTimers();
      const titleOnly = [
        {
          bookId: '44767458',
          bookUrl: '/book/show/44767458-dune',
          title: 'Dune (Dune, #1)',
          bookTitleBare: 'Dune',
          author: 'Frank Patrick Herbert',
          ratingsCount: 1_600_000,
        },
        {
          bookId: '110',
          bookUrl: '/book/show/110.The_Road_to_Dune',
          title: 'The Road to Dune',
          bookTitleBare: 'The Road to Dune',
          author: 'Frank Herbert',
          ratingsCount: 20_000,
        },
      ];
      const titleWithAuthor = [
        {
          bookId: '110',
          bookUrl: '/book/show/110.The_Road_to_Dune',
          title: 'The Road to Dune',
          bookTitleBare: 'The Road to Dune',
          author: 'Frank Herbert',
          ratingsCount: 20_000,
        },
      ];

      global.fetch = vi.fn((input: Parameters<typeof fetch>[0]) => {
        const url = fetchUrl(input);
        if (url.includes('q=Dune%20Frank%20Herbert')) return Promise.resolve({ ok: true, json: () => Promise.resolve(titleWithAuthor) });
        if (url.includes('q=Dune')) return Promise.resolve({ ok: true, json: () => Promise.resolve(titleOnly) });
        if (url.includes('/book/show/44767458')) {
          return Promise.resolve({ ok: true, text: () => Promise.resolve(goodreadsBookHtml('44767458', 'Dune')) });
        }
        return Promise.resolve({ ok: true, text: () => Promise.resolve(goodreadsBookHtml('110', 'The Road to Dune')) });
      }) as never;

      const searchPromise = provider.search({ title: 'Dune', author: 'Frank Herbert' });
      await vi.runAllTimersAsync();
      const result = await searchPromise;

      const bookFetchUrls = vi
        .mocked(global.fetch)
        .mock.calls.map(([url]) => fetchUrl(url))
        .filter((url) => url.includes('/book/show/'));
      expect(bookFetchUrls[0]).toBe('https://www.goodreads.com/book/show/44767458');
      expect(result[0].title).toBe('Dune');
    });

    it('keeps fetching detail pages after one loads but fails to parse', async () => {
      vi.useFakeTimers();
      const autocomplete = [
        { bookId: '1', bookUrl: '/book/show/1.B1', title: 'B1', bookTitleBare: 'B1' },
        { bookId: '2', bookUrl: '/book/show/2.B2', title: 'B2', bookTitleBare: 'B2' },
      ];

      global.fetch = vi.fn((input: Parameters<typeof fetch>[0]) => {
        const url = fetchUrl(input);
        if (url.includes('/auto_complete')) return Promise.resolve({ ok: true, json: () => Promise.resolve(autocomplete) });
        if (url.includes('/book/show/1')) return Promise.resolve({ ok: true, text: () => Promise.resolve('<html>no data</html>') });
        return Promise.resolve({ ok: true, text: () => Promise.resolve(goodreadsBookHtml('2', 'B2 From Detail')) });
      }) as never;

      const searchPromise = provider.search({ title: 'B' });
      await vi.runAllTimersAsync();
      const result = await searchPromise;

      const detailUrls = vi
        .mocked(global.fetch)
        .mock.calls.map(([url]) => fetchUrl(url))
        .filter((url) => url.includes('/book/show/'));
      expect(detailUrls).toContain('https://www.goodreads.com/book/show/2');
      expect(result.find((c) => c.providerId === '2')?.title).toBe('B2 From Detail');
      expect(result.find((c) => c.providerId === '1')?.title).toBe('B1');
    });

    it('reports a bot challenge as a throttle instead of quietly degrading the whole batch', async () => {
      vi.useFakeTimers();
      const autocomplete = [
        { bookId: '1', bookUrl: '/book/show/1.B1', title: 'B1', bookTitleBare: 'B1' },
        { bookId: '2', bookUrl: '/book/show/2.B2', title: 'B2', bookTitleBare: 'B2' },
      ];

      global.fetch = vi.fn((input: Parameters<typeof fetch>[0]) => {
        const url = fetchUrl(input);
        if (url.includes('/auto_complete')) return Promise.resolve({ ok: true, json: () => Promise.resolve(autocomplete) });
        return Promise.resolve({ ok: true, status: 202, text: () => Promise.resolve('<div id="challenge-container"></div>') });
      }) as never;

      // The rejection lands while the timers run, so the assertion has to be attached before then:
      // a rejected promise nobody is holding is an unhandled rejection, which fails the whole run.
      const rejects = expect(provider.search({ title: 'B' })).rejects.toBeInstanceOf(ProviderThrottleError);
      await vi.runAllTimersAsync();

      await rejects;
      const detailUrls = vi
        .mocked(global.fetch)
        .mock.calls.map(([url]) => fetchUrl(url))
        .filter((url) => url.includes('/book/show/'));
      expect(detailUrls).toEqual(['https://www.goodreads.com/book/show/1']);
    });

    it('salvages the books already scraped when a bot challenge stops the batch part-way', async () => {
      vi.useFakeTimers();
      const autocomplete = [
        {
          bookId: '222794853',
          bookUrl: '/book/show/222794853.The_First_Witch_of_Boston',
          title: 'The First Witch of Boston',
          bookTitleBare: 'The First Witch of Boston',
        },
        {
          bookId: '247090873',
          bookUrl: '/book/show/247090873.The_First_Witch_of_Boston_Book_Two',
          title: 'The First Witch of Boston Book Two',
          bookTitleBare: 'The First Witch of Boston Book Two',
        },
      ];
      let firstBookAttempts = 0;

      global.fetch = vi.fn((input: Parameters<typeof fetch>[0]) => {
        const url = fetchUrl(input);
        if (url.includes('/auto_complete')) return Promise.resolve({ ok: true, json: () => Promise.resolve(autocomplete) });
        if (url.includes('/book/show/222794853')) {
          firstBookAttempts += 1;
          // Goodreads sheds load with a bare 503 that clears on the next try.
          if (firstBookAttempts === 1) return Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve('') });
          return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(goodreadsBookHtml('222794853', 'The First Witch of Boston')) });
        }
        return Promise.resolve({ ok: true, status: 202, text: () => Promise.resolve('') });
      }) as never;

      // Attach the handler before the timers run: a rejected promise nobody is holding is an
      // unhandled rejection, which fails the whole run.
      const settled = provider.search({ title: 'The First Witch of Boston' }).catch((err: unknown) => err);
      await vi.runAllTimersAsync();
      const error = await settled;

      expect(error).toBeInstanceOf(ProviderThrottleError);
      const throttle = error as ProviderThrottleError;
      expect(throttle.partialCandidates.map((c) => c.providerId)).toEqual(['222794853', '247090873']);
      // The first book was scraped in full; the challenged one falls back to its autocomplete entry.
      expect(throttle.partialCandidates[0].title).toBe('The First Witch of Boston');
      expect(throttle.partialCandidates[1].title).toBe('The First Witch of Boston Book Two');

      const detailUrls = vi
        .mocked(global.fetch)
        .mock.calls.map(([url]) => fetchUrl(url))
        .filter((url) => url.includes('/book/show/'));
      expect(detailUrls).toEqual([
        'https://www.goodreads.com/book/show/222794853',
        'https://www.goodreads.com/book/show/222794853',
        'https://www.goodreads.com/book/show/247090873',
      ]);
    });

    it('reports a bot challenge on a direct lookup as a throttle', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue({ ok: true, status: 202, text: () => Promise.resolve('<div id="challenge-container"></div>') }) as never;

      await expect(provider.lookupById('123')).rejects.toBeInstanceOf(ProviderThrottleError);
    });

    it('leaves the description empty when an unavailable detail page forces the truncated autocomplete blurb', async () => {
      vi.useFakeTimers();
      const autocomplete = [
        {
          bookId: '229004506',
          bookUrl: '/book/show/229004506-the-widow',
          title: 'The Widow',
          bookTitleBare: 'The Widow',
          author: { name: 'John Grisham' },
          numPages: 404,
          description: {
            html: 'Simon Latch is a lawyer in rural Virginia, making just enough to pay his bills while his marriage slowly falls apart. Then into his office walks Eleanor Barnett, an elderly wi\u2026',
            truncated: true,
          },
        },
      ];

      global.fetch = vi.fn((input: Parameters<typeof fetch>[0]) => {
        const url = fetchUrl(input);
        if (url.includes('/auto_complete')) return Promise.resolve({ ok: true, json: () => Promise.resolve(autocomplete) });
        return Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve('') });
      }) as never;

      const searchPromise = provider.search({ title: 'The Widow', author: 'John Grisham' });
      await vi.runAllTimersAsync();
      const result = await searchPromise;

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('The Widow');
      expect(result[0].pageCount).toBe(404);
      expect(result[0].description).toBeUndefined();
    });

    it('retries a detail page Goodreads reports as temporarily unavailable', async () => {
      vi.useFakeTimers();
      const autocomplete = [{ bookId: '1', bookUrl: '/book/show/1.B1', title: 'B1', bookTitleBare: 'B1' }];
      let detailAttempts = 0;

      global.fetch = vi.fn((input: Parameters<typeof fetch>[0]) => {
        const url = fetchUrl(input);
        if (url.includes('/auto_complete')) return Promise.resolve({ ok: true, json: () => Promise.resolve(autocomplete) });
        detailAttempts += 1;
        if (detailAttempts === 1) return Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve('') });
        return Promise.resolve({ ok: true, text: () => Promise.resolve(goodreadsBookHtml('1', 'B1 From Detail')) });
      }) as never;

      const searchPromise = provider.search({ title: 'B' });
      await vi.runAllTimersAsync();
      const result = await searchPromise;

      expect(detailAttempts).toBe(2);
      expect(result[0].title).toBe('B1 From Detail');
    });

    it('stops retrying a detail page once the attempt budget is spent', async () => {
      vi.useFakeTimers();
      const autocomplete = [{ bookId: '1', bookUrl: '/book/show/1.B1', title: 'B1', bookTitleBare: 'B1' }];
      let detailAttempts = 0;

      global.fetch = vi.fn((input: Parameters<typeof fetch>[0]) => {
        const url = fetchUrl(input);
        if (url.includes('/auto_complete')) return Promise.resolve({ ok: true, json: () => Promise.resolve(autocomplete) });
        detailAttempts += 1;
        return Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve('') });
      }) as never;

      const searchPromise = provider.search({ title: 'B' });
      await vi.runAllTimersAsync();
      const result = await searchPromise;

      expect(detailAttempts).toBe(3);
      expect(result[0].title).toBe('B1');
    });

    it('keeps fetching detail pages for the rest of the batch after one is temporarily unavailable', async () => {
      vi.useFakeTimers();
      const autocomplete = [
        { bookId: '1', bookUrl: '/book/show/1.B1', title: 'B1', bookTitleBare: 'B1' },
        { bookId: '2', bookUrl: '/book/show/2.B2', title: 'B2', bookTitleBare: 'B2' },
      ];

      global.fetch = vi.fn((input: Parameters<typeof fetch>[0]) => {
        const url = fetchUrl(input);
        if (url.includes('/auto_complete')) return Promise.resolve({ ok: true, json: () => Promise.resolve(autocomplete) });
        if (url.includes('/book/show/1')) return Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve('') });
        return Promise.resolve({ ok: true, text: () => Promise.resolve(goodreadsBookHtml('2', 'B2 From Detail')) });
      }) as never;

      const searchPromise = provider.search({ title: 'B' });
      await vi.runAllTimersAsync();
      const result = await searchPromise;

      expect(result.find((c) => c.providerId === '1')?.title).toBe('B1');
      expect(result.find((c) => c.providerId === '2')?.title).toBe('B2 From Detail');
    });

    it('does not retry a detail page that is simply missing', async () => {
      vi.useFakeTimers();
      const autocomplete = [{ bookId: '1', bookUrl: '/book/show/1.B1', title: 'B1', bookTitleBare: 'B1' }];
      let detailAttempts = 0;

      global.fetch = vi.fn((input: Parameters<typeof fetch>[0]) => {
        const url = fetchUrl(input);
        if (url.includes('/auto_complete')) return Promise.resolve({ ok: true, json: () => Promise.resolve(autocomplete) });
        detailAttempts += 1;
        return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
      }) as never;

      const searchPromise = provider.search({ title: 'B' });
      await vi.runAllTimersAsync();
      const result = await searchPromise;

      expect(detailAttempts).toBe(1);
      expect(result[0].title).toBe('B1');
    });
  });

  describe('lookupById', () => {
    it('should fetch book by id', async () => {
      const mockState = { 'Book:kca:123': { title: 'Test Book' } };
      const bookHtml = `<script id="__NEXT_DATA__">{"props":{"pageProps":{"apolloState":${JSON.stringify(mockState)}}}}</script>`;

      global.fetch = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(bookHtml) });

      const result = await provider.lookupById('123');

      expect(global.fetch).toHaveBeenCalledWith('https://www.goodreads.com/book/show/123', expect.any(Object));
      expect(result?.title).toBe('Test Book');
    });

    it('should return null if disabled', async () => {
      vi.spyOn(providerConfig, 'getConfig').mockResolvedValue({
        ...mockConfig,
        goodreads: { enabled: false },
      });
      const result = await provider.lookupById('123');
      expect(result).toBeNull();
    });

    it('should return null if no apolloState', async () => {
      const bookHtml = `<script id="__NEXT_DATA__">{"props":{"pageProps":{}}}</script>`;
      global.fetch = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(bookHtml) });
      const result = await provider.lookupById('123');
      expect(result).toBeNull();
    });

    it('should return null if extractNextData fails', async () => {
      const bookHtml = `<html><body>No data</body></html>`;
      global.fetch = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(bookHtml) });
      const result = await provider.lookupById('123');
      expect(result).toBeNull();
    });
  });
});
