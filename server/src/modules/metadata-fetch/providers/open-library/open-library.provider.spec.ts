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
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpenLibraryProvider,
        {
          provide: ProviderConfigService,
          useValue: {
            getConfig: jest.fn().mockResolvedValue(mockConfig),
          },
        },
      ],
    }).compile();

    provider = module.get<OpenLibraryProvider>(OpenLibraryProvider);
    providerConfig = module.get<ProviderConfigService>(ProviderConfigService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('search', () => {
    it('should return empty array if disabled', async () => {
      jest.spyOn(providerConfig, 'getConfig').mockResolvedValue({
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
        json: jest.fn().mockResolvedValue({
          docs: [
            {
              key: '/works/OL1W',
              title: 'Test Book',
              author_name: ['Test Author'],
            },
          ],
        }),
      };
      global.fetch = jest.fn().mockResolvedValue(mockFetchResponse);

      const result = await provider.search({ title: 'Test Book' });

      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('https://openlibrary.org/search.json?title=Test+Book'), expect.any(Object));
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Test Book');
      expect(result[0].providerId).toBe('OL1W');
    });

    it('should prioritize ISBN in search', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ docs: [] }),
      });

      await provider.search({ title: 'Test Book', isbn: '1234567890' });

      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('isbn=1234567890'), expect.any(Object));
      expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining('title=Test+Book'), expect.any(Object));
    });

    it('should return empty array on fetch error', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false });

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
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockWork),
      });

      const result = await provider.lookupById('OL1W');

      expect(global.fetch).toHaveBeenCalledWith('https://openlibrary.org/works/OL1W.json', expect.any(Object));
      expect(result).not.toBeNull();
      expect(result?.title).toBe('Test Book');
    });

    it('should return null if disabled', async () => {
      jest.spyOn(providerConfig, 'getConfig').mockResolvedValue({
        ...mockConfig,
        openLibrary: { enabled: false },
      });

      const result = await provider.lookupById('OL1W');
      expect(result).toBeNull();
    });

    it('should return null on fetch error', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false });

      const result = await provider.lookupById('OL1W');
      expect(result).toBeNull();
    });
  });
});
