import { Test, TestingModule } from '@nestjs/testing';
import { ProviderConfigurations } from '@projectx/types';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { GoogleProvider } from './google.provider';

describe('GoogleProvider', () => {
  let provider: GoogleProvider;
  let providerConfig: ProviderConfigService;

  const mockConfig: ProviderConfigurations = {
    google: { enabled: true, apiKey: 'test-api-key' },
    amazon: { enabled: true, domain: 'amazon.com', cookie: '' },
    goodreads: { enabled: true },
    hardcover: { enabled: false, apiKey: '' },
    openLibrary: { enabled: true },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleProvider,
        {
          provide: ProviderConfigService,
          useValue: {
            getConfig: jest.fn().mockResolvedValue(mockConfig),
          },
        },
      ],
    }).compile();

    provider = module.get<GoogleProvider>(GoogleProvider);
    providerConfig = module.get<ProviderConfigService>(ProviderConfigService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('search', () => {
    it('should return empty array if disabled', async () => {
      jest.spyOn(providerConfig, 'getConfig').mockResolvedValue({
        ...mockConfig,
        google: { enabled: false, apiKey: '' },
      });

      const result = await provider.search({ title: 'Test' });
      expect(result).toEqual([]);
    });

    it('should fetch from Google Books and return mapped volumes', async () => {
      const mockVolume = {
        id: 'vol1',
        volumeInfo: { title: 'Test Book', authors: ['Author'] },
      };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ items: [mockVolume] }),
      });

      const result = await provider.search({ title: 'Test Book' });

      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('https://www.googleapis.com/books/v1/volumes'), expect.any(Object));
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('q=intitle%3ATest+Book'), expect.any(Object));
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('key=test-api-key'), expect.any(Object));
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Test Book');
      expect(result[0].providerId).toBe('vol1');
    });

    it('should handle search with ISBN', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ items: [] }),
      });

      await provider.search({ isbn: '1234567890' });

      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('q=isbn%3A1234567890'), expect.any(Object));
    });

    it('should return empty array on fetch error', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });

      const result = await provider.search({ title: 'Test' });
      expect(result).toEqual([]);
    });

    it('should return empty array if no results', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({}),
      });

      const result = await provider.search({ title: 'Test' });
      expect(result).toEqual([]);
    });
  });

  describe('lookupById', () => {
    it('should fetch volume by id and return mapped volume', async () => {
      const mockVolume = {
        id: 'vol1',
        volumeInfo: { title: 'Test Book' },
      };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockVolume),
      });

      const result = await provider.lookupById('vol1');

      expect(global.fetch).toHaveBeenCalledWith('https://www.googleapis.com/books/v1/volumes/vol1?key=test-api-key', expect.any(Object));
      expect(result).not.toBeNull();
      expect(result?.title).toBe('Test Book');
    });

    it('should return null on fetch error', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });

      const result = await provider.lookupById('vol1');
      expect(result).toBeNull();
    });
  });
});
