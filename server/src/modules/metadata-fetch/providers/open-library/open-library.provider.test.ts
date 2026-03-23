import { Test, TestingModule } from '@nestjs/testing';
import { ProviderConfigurations } from '@projectx/types';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { OpenLibraryProvider } from './open-library.provider';

describe('OpenLibraryProvider', () => {
  let provider: OpenLibraryProvider;
  let providerConfig: ProviderConfigService;

  const mockConfig: ProviderConfigurations = {
    google: { enabled: true, apiKey: '' },
    amazon: { enabled: true, domain: 'amazon.com', cookie: '' },
    goodreads: { enabled: true },
    hardcover: { enabled: false, apiKey: '' },
    openLibrary: { enabled: true },
    itunes: { enabled: true },
    audible: { enabled: false, domain: 'com' },
    audnexus: { enabled: false },
    comicvine: { enabled: false, apiKey: '' },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpenLibraryProvider,
        {
          provide: ProviderConfigService,
          useValue: {
            getConfig: vi.fn().mockResolvedValue(mockConfig),
          },
        },
      ],
    }).compile();

    provider = module.get<OpenLibraryProvider>(OpenLibraryProvider);
    providerConfig = module.get<ProviderConfigService>(ProviderConfigService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('search', () => {
    it('should return empty array if disabled', async () => {
      vi.spyOn(providerConfig, 'getConfig').mockResolvedValue({
        ...mockConfig,
        openLibrary: { enabled: false },
      });

      const result = await provider.search({ title: 'Test' });
      expect(result).toEqual([]);
    });

    it('should return empty array if no isbn or title provided', async () => {
      const result = await provider.search({ author: 'Test' });
      expect(result).toEqual([]);
    });

    it('should fetch from openlibrary and return mapped docs', async () => {
      const mockFetchResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          docs: [
            {
              key: '/works/OL1W',
              title: 'Test Book',
              author_name: ['Test Author'],
            },
          ],
        }),
      };
      global.fetch = vi.fn().mockResolvedValue(mockFetchResponse);

      const result = await provider.search({ title: 'Test Book' });

      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('https://openlibrary.org/search.json?title=Test+Book'), expect.any(Object));
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Test Book');
      expect(result[0].providerId).toBe('OL1W');
    });

    it('should prioritize ISBN in search', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ docs: [] }),
      });

      await provider.search({ title: 'Test Book', isbn: '1234567890' });

      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('isbn=1234567890'), expect.any(Object));
      expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining('title=Test+Book'), expect.any(Object));
    });

    it('should return empty array on fetch error', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false });

      const result = await provider.search({ title: 'Test' });
      expect(result).toEqual([]);
    });
  });

  describe('lookupById', () => {
    it('should fetch work by id and return mapped work', async () => {
      const mockWork = {
        key: '/works/OL1W',
        title: 'Test Book',
      };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockWork),
      });

      const result = await provider.lookupById('OL1W');

      expect(global.fetch).toHaveBeenCalledWith('https://openlibrary.org/works/OL1W.json', expect.any(Object));
      expect(result).not.toBeNull();
      expect(result?.title).toBe('Test Book');
    });

    it('should return null if disabled', async () => {
      vi.spyOn(providerConfig, 'getConfig').mockResolvedValue({
        ...mockConfig,
        openLibrary: { enabled: false },
      });

      const result = await provider.lookupById('OL1W');
      expect(result).toBeNull();
    });

    it('should return null on fetch error', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false });

      const result = await provider.lookupById('OL1W');
      expect(result).toBeNull();
    });

    it('should backfill genres from search when work payload has no subjects', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            key: '/works/OL1W',
            title: 'Test Book',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            docs: [
              {
                key: '/works/OL1W',
                subject: ['Fiction', 'Classic'],
              },
            ],
          }),
        });

      const result = await provider.lookupById('OL1W');

      expect(result?.genres).toEqual(['Fiction', 'Classic']);
    });
  });
});
