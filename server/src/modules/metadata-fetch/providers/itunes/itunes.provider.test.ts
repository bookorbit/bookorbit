import { Test, TestingModule } from '@nestjs/testing';
import { ProviderConfigurations } from '@projectx/types';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { ITunesProvider } from './itunes.provider';

describe('ITunesProvider', () => {
  let provider: ITunesProvider;
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
        ITunesProvider,
        {
          provide: ProviderConfigService,
          useValue: {
            getConfig: vi.fn().mockResolvedValue(mockConfig),
          },
        },
      ],
    }).compile();

    provider = module.get<ITunesProvider>(ITunesProvider);
    providerConfig = module.get<ProviderConfigService>(ProviderConfigService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('search', () => {
    it('should return empty array if disabled', async () => {
      vi.spyOn(providerConfig, 'getConfig').mockResolvedValue({
        ...mockConfig,
        itunes: { enabled: false },
      });

      const result = await provider.search({ title: 'Test' });
      expect(result).toEqual([]);
    });

    it('should fetch from iTunes and return mapped results', async () => {
      const mockResult = {
        trackId: 123,
        trackName: 'Test Book',
        artistName: 'Author',
        kind: 'ebook',
        artworkUrl100: 'https://example.com/100x100bb.jpg',
      };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ results: [mockResult] }),
      });

      const result = await provider.search({ title: 'Test Book' });

      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('https://itunes.apple.com/search'), expect.any(Object));
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('term=Test+Book'), expect.any(Object));
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('entity=ebook'), expect.any(Object));
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Test Book');
      expect(result[0].providerId).toBe('123');
      expect(result[0].coverUrl).toBe('https://example.com/1000x1000bb.jpg');
    });

    it('should handle search with ISBN', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ results: [] }),
      });

      await provider.search({ isbn: '1234567890' });

      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('term=1234567890'), expect.any(Object));
    });

    it('should return empty array on fetch error', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

      const result = await provider.search({ title: 'Test' });
      expect(result).toEqual([]);
    });
  });

  describe('lookupById', () => {
    it('should fetch book by id and return mapped result', async () => {
      const mockResult = {
        trackId: 123,
        trackName: 'Test Book',
        artistName: 'Author',
        kind: 'ebook',
      };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ results: [mockResult] }),
      });

      const result = await provider.lookupById('123');

      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('https://itunes.apple.com/lookup'), expect.any(Object));
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('id=123'), expect.any(Object));
      expect(result).not.toBeNull();
      expect(result?.title).toBe('Test Book');
    });

    it('should return null if no results', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ results: [] }),
      });

      const result = await provider.lookupById('123');
      expect(result).toBeNull();
    });

    it('should return null on fetch error', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });

      const result = await provider.lookupById('123');
      expect(result).toBeNull();
    });
  });
});
