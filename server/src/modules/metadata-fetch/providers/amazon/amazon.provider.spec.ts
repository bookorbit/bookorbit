import { Test, TestingModule } from '@nestjs/testing';
import { ProviderConfigurations } from '@projectx/types';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { AmazonProvider } from './amazon.provider';

describe('AmazonProvider', () => {
  let provider: AmazonProvider;
  let providerConfig: ProviderConfigService;

  const mockConfig: ProviderConfigurations = {
    google: { enabled: true, apiKey: '' },
    amazon: { enabled: true, domain: 'amazon.com', cookie: 'test-cookie' },
    goodreads: { enabled: true },
    hardcover: { enabled: false, apiKey: '' },
    openLibrary: { enabled: true },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AmazonProvider,
        {
          provide: ProviderConfigService,
          useValue: {
            getConfig: jest.fn().mockResolvedValue(mockConfig),
          },
        },
      ],
    }).compile();

    provider = module.get<AmazonProvider>(AmazonProvider);
    providerConfig = module.get<ProviderConfigService>(ProviderConfigService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe('search', () => {
    it('should return empty array if disabled', async () => {
      jest.spyOn(providerConfig, 'getConfig').mockResolvedValue({
        ...mockConfig,
        amazon: { enabled: false, domain: 'amazon.com', cookie: '' },
      });

      const result = await provider.search({ title: 'Test' });
      expect(result).toEqual([]);
    });

    it('should search by title/author and fetch book details', async () => {
      const searchHtml = `
        <div data-component-type="s-search-result" data-asin="B123456789">
          <div data-cy="title-recipe">Test Book</div>
        </div>
      `;
      const bookHtml = `
        <span id="productTitle">Test Book</span>
        <div id="bylineInfo"><span class="author"><a href="#">Author</a></span></div>
      `;

      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(searchHtml) })
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(bookHtml) });

      const result = await provider.search({ title: 'Test Book' });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://www.amazon.com/s?k=Test%20Book'),
        expect.objectContaining({
          headers: expect.objectContaining({ cookie: 'test-cookie' }),
        }),
      );
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Test Book');
      expect(result[0].providerId).toBe('B123456789');
    });

    it('should handle sleep between requests', async () => {
      const BETWEEN_REQUESTS_MS = 800;
      jest.useFakeTimers();
      const searchHtml = `
        <div data-component-type="s-search-result" data-asin="ASIN000001"></div>
        <div data-component-type="s-search-result" data-asin="ASIN000002"></div>
      `;
      const bookHtml = `<span id="productTitle">Book</span>`;

      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(searchHtml) })
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(bookHtml) })
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(bookHtml) });

      const searchPromise = provider.search({ title: 'Test' });

      await jest.advanceTimersByTimeAsync(0); // Search
      await jest.advanceTimersByTimeAsync(0); // First fetch
      await jest.advanceTimersByTimeAsync(BETWEEN_REQUESTS_MS); // Sleep
      await jest.advanceTimersByTimeAsync(0); // Second fetch

      const result = await searchPromise;
      expect(result).toHaveLength(2);
    });

    it('should handle fetch failure', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
      const result = await provider.search({ title: 'Test' });
      expect(result).toEqual([]);
    });

    it('should return empty if no title in parsed page', async () => {
      const searchHtml = `<div data-component-type="s-search-result" data-asin="ASIN000001"></div>`;
      const bookHtml = `<div>No title</div>`;
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(searchHtml) })
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(bookHtml) });

      const result = await provider.search({ title: 'Test' });
      expect(result).toEqual([]);
    });
  });

  describe('lookupById', () => {
    it('should return null if disabled', async () => {
      jest.spyOn(providerConfig, 'getConfig').mockResolvedValue({
        ...mockConfig,
        amazon: { enabled: false },
      });
      const result = await provider.lookupById('B123');
      expect(result).toBeNull();
    });

    it('should return null if fetch fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false });
      const result = await provider.lookupById('B123');
      expect(result).toBeNull();
    });

    it('should fetch by ASIN', async () => {
      const bookHtml = `<span id="productTitle">Test Book</span>`;
      global.fetch = jest.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(bookHtml) });

      const result = await provider.lookupById('B123');

      expect(global.fetch).toHaveBeenCalledWith('https://www.amazon.com/dp/B123', expect.any(Object));
      expect(result?.title).toBe('Test Book');
    });
  });
});
