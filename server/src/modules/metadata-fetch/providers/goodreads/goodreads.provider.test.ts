import { Test, TestingModule } from '@nestjs/testing';
import { ProviderConfigurations } from '@projectx/types';

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
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoodreadsProvider,
        {
          provide: ProviderConfigService,
          useValue: {
            getConfig: vi.fn().mockResolvedValue(mockConfig),
          },
        },
      ],
    }).compile();

    provider = module.get<GoodreadsProvider>(GoodreadsProvider);
    providerConfig = module.get<ProviderConfigService>(ProviderConfigService);
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
      // Mock search HTML
      const searchHtml = `
        <a href="/book/show/123.Some_Book?from_srp=true">Some Book</a>
      `;
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
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(searchHtml) })
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(bookHtml) });

      const result = await provider.search({ title: 'Some Book' });

      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('https://www.goodreads.com/search?q=Some%20Book'), expect.any(Object));
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
      const searchHtml = `
        <a href="/book/show/1?from_srp=true">B1</a>
        <a href="/book/show/2?from_srp=true">B2</a>
      `;
      const mockState1 = { 'Book:kca:1': { title: 'B1' } };
      const mockState2 = { 'Book:kca:2': { title: 'B2' } };
      const bookHtml1 = `<script id="__NEXT_DATA__">{"props":{"pageProps":{"apolloState":${JSON.stringify(mockState1)}}}}</script>`;
      const bookHtml2 = `<script id="__NEXT_DATA__">{"props":{"pageProps":{"apolloState":${JSON.stringify(mockState2)}}}}</script>`;

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(searchHtml) })
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

    it('should use slug-based scoring in extractBookIds', async () => {
      const BETWEEN_REQUESTS_MS = 600;
      vi.useFakeTimers();
      const searchHtml = `
        <a href="/book/show/1.The_Great_Gatsby?from_srp=true">B1</a>
        <a href="/book/show/2.Something_Else?from_srp=true">B2</a>
        <a href="/book/show/3.Gatsby_Study_Guide?from_srp=true">B3</a>
        <a href="/book/show/4.The_Great_Gatsby_Special?from_srp=true">B4</a>
      `;
      // limit is 3, so B2 should be dropped if it has lower score
      const mockState = { 'Book:kca:1': { title: 'B' } };
      const bookHtml = `<script id="__NEXT_DATA__">{"props":{"pageProps":{"apolloState":${JSON.stringify(mockState)}}}}</script>`;

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(searchHtml) })
        .mockResolvedValue({ ok: true, text: () => Promise.resolve(bookHtml) });

      const searchPromise = provider.search({ title: 'The Great Gatsby' });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(BETWEEN_REQUESTS_MS);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(BETWEEN_REQUESTS_MS);
      await vi.advanceTimersByTimeAsync(0);
      await searchPromise;
      expect(global.fetch).toHaveBeenCalledTimes(4); // 1 search + 3 book lookups
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
