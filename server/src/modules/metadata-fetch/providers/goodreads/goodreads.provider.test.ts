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
