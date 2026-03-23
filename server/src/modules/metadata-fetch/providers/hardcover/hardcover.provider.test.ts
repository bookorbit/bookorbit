import { Test, TestingModule } from '@nestjs/testing';
import { ProviderConfigurations } from '@projectx/types';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { HardcoverClient } from './hardcover.client';
import { HardcoverProvider } from './hardcover.provider';
import { HardcoverBookWithEditions, HardcoverSearchDocument } from './hardcover.types';

const mockConfig: ProviderConfigurations = {
  google: { enabled: true, apiKey: '' },
  amazon: { enabled: true, domain: 'amazon.com', cookie: '' },
  goodreads: { enabled: true },
  hardcover: { enabled: true, apiKey: 'test-key' },
  openLibrary: { enabled: true },
  itunes: { enabled: true },
  audible: { enabled: false, domain: 'com' },
  audnexus: { enabled: false },
  comicvine: { enabled: false, apiKey: '' },
};

const mockDocument: HardcoverSearchDocument = {
  id: '379217',
  slug: 'the-name-of-the-wind',
  title: 'The Name of the Wind',
  author_names: ['Patrick Rothfuss'],
  release_year: 2007,
  image: { url: 'https://assets.hardcover.app/cover.jpg' },
};

const mockBook: HardcoverBookWithEditions = {
  id: 379217,
  slug: 'the-name-of-the-wind',
  title: 'The Name of the Wind',
  editions: [
    {
      id: 1001,
      title: 'The Name of the Wind',
      isbn_13: '9780756404079',
      isbn_10: '0756404079',
      release_year: 2007,
    },
  ],
};

describe('HardcoverProvider', () => {
  let provider: HardcoverProvider;
  let client: HardcoverClient;
  let providerConfig: ProviderConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HardcoverProvider,
        {
          provide: HardcoverClient,
          useValue: {
            searchByIsbn: vi.fn().mockResolvedValue([]),
            searchBooks: vi.fn().mockResolvedValue([]),
            lookupBySlug: vi.fn().mockResolvedValue(null),
          },
        },
        {
          provide: ProviderConfigService,
          useValue: {
            getConfig: vi.fn().mockResolvedValue(mockConfig),
          },
        },
      ],
    }).compile();

    provider = module.get(HardcoverProvider);
    client = module.get(HardcoverClient);
    providerConfig = module.get(ProviderConfigService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('search', () => {
    it('returns empty array when disabled', async () => {
      vi.spyOn(providerConfig, 'getConfig').mockResolvedValue({ ...mockConfig, hardcover: { enabled: false, apiKey: 'test-key' } });
      expect(await provider.search({ title: 'Test' })).toEqual([]);
      expect(client.searchByIsbn).not.toHaveBeenCalled();
      expect(client.searchBooks).not.toHaveBeenCalled();
    });

    it('returns empty array when apiKey is missing', async () => {
      vi.spyOn(providerConfig, 'getConfig').mockResolvedValue({ ...mockConfig, hardcover: { enabled: true, apiKey: '' } });
      expect(await provider.search({ title: 'Test' })).toEqual([]);
      expect(client.searchByIsbn).not.toHaveBeenCalled();
      expect(client.searchBooks).not.toHaveBeenCalled();
    });

    it('returns empty array when no isbn and no title', async () => {
      expect(await provider.search({})).toEqual([]);
      expect(client.searchByIsbn).not.toHaveBeenCalled();
      expect(client.searchBooks).not.toHaveBeenCalled();
    });

    it('searches by ISBN and returns mapped editions when found', async () => {
      vi.spyOn(client, 'searchByIsbn').mockResolvedValue([mockBook]);

      const results = await provider.search({ isbn: '9780756404079' });

      expect(client.searchByIsbn).toHaveBeenCalledWith('9780756404079', 'test-key');
      expect(client.searchBooks).not.toHaveBeenCalled();
      expect(results).toHaveLength(1);
      expect(results[0].providerId).toBe('the-name-of-the-wind');
      expect(results[0].isbn13).toBe('9780756404079');
    });

    it('falls through to title search when ISBN returns no results', async () => {
      vi.spyOn(client, 'searchByIsbn').mockResolvedValue([]);
      vi.spyOn(client, 'searchBooks').mockResolvedValue([mockDocument]);

      const results = await provider.search({ isbn: '9780756404079', title: 'The Name of the Wind' });

      expect(client.searchByIsbn).toHaveBeenCalledWith('9780756404079', 'test-key');
      expect(client.searchBooks).toHaveBeenCalled();
      expect(results).toHaveLength(1);
    });

    it('searches title+author combined when author is provided', async () => {
      vi.spyOn(client, 'searchBooks').mockResolvedValue([mockDocument]);

      await provider.search({ title: 'The Name of the Wind', author: 'Patrick Rothfuss' });

      expect(client.searchBooks).toHaveBeenCalledWith('The Name of the Wind Patrick Rothfuss', 'test-key');
    });

    it('retries with title only when title+author returns no results', async () => {
      vi.spyOn(client, 'searchBooks').mockResolvedValueOnce([]).mockResolvedValueOnce([mockDocument]);

      const results = await provider.search({ title: 'The Name of the Wind', author: 'Patrick Rothfuss' });

      expect(client.searchBooks).toHaveBeenCalledTimes(2);
      expect(client.searchBooks).toHaveBeenNthCalledWith(1, 'The Name of the Wind Patrick Rothfuss', 'test-key');
      expect(client.searchBooks).toHaveBeenNthCalledWith(2, 'The Name of the Wind', 'test-key');
      expect(results).toHaveLength(1);
    });

    it('searches by title only when no author is provided', async () => {
      vi.spyOn(client, 'searchBooks').mockResolvedValue([mockDocument]);

      await provider.search({ title: 'The Name of the Wind' });

      expect(client.searchBooks).toHaveBeenCalledTimes(1);
      expect(client.searchBooks).toHaveBeenCalledWith('The Name of the Wind', 'test-key');
    });

    it('returns empty array when title search returns nothing', async () => {
      vi.spyOn(client, 'searchBooks').mockResolvedValue([]);

      expect(await provider.search({ title: 'Unknown Book' })).toEqual([]);
    });

    it('passes the apiKey to the client', async () => {
      vi.spyOn(providerConfig, 'getConfig').mockResolvedValue({ ...mockConfig, hardcover: { enabled: true, apiKey: 'my-secret-key' } });
      vi.spyOn(client, 'searchBooks').mockResolvedValue([mockDocument]);

      await provider.search({ title: 'Test' });

      expect(client.searchBooks).toHaveBeenCalledWith('Test', 'my-secret-key');
    });
  });

  describe('lookupById', () => {
    it('returns null when disabled', async () => {
      vi.spyOn(providerConfig, 'getConfig').mockResolvedValue({ ...mockConfig, hardcover: { enabled: false, apiKey: 'test-key' } });
      expect(await provider.lookupById('the-name-of-the-wind')).toBeNull();
      expect(client.lookupBySlug).not.toHaveBeenCalled();
    });

    it('returns null when apiKey is missing', async () => {
      vi.spyOn(providerConfig, 'getConfig').mockResolvedValue({ ...mockConfig, hardcover: { enabled: true, apiKey: '' } });
      expect(await provider.lookupById('the-name-of-the-wind')).toBeNull();
      expect(client.lookupBySlug).not.toHaveBeenCalled();
    });

    it('looks up by slug and returns the first mapped candidate', async () => {
      vi.spyOn(client, 'lookupBySlug').mockResolvedValue(mockBook);

      const result = await provider.lookupById('the-name-of-the-wind');

      expect(client.lookupBySlug).toHaveBeenCalledWith('the-name-of-the-wind', 'test-key');
      expect(result).not.toBeNull();
      expect(result?.providerId).toBe('the-name-of-the-wind');
      expect(result?.isbn13).toBe('9780756404079');
    });

    it('returns null when the slug is not found', async () => {
      vi.spyOn(client, 'lookupBySlug').mockResolvedValue(null);
      expect(await provider.lookupById('nonexistent-book')).toBeNull();
    });

    it('returns null when the book has no editions', async () => {
      vi.spyOn(client, 'lookupBySlug').mockResolvedValue({ ...mockBook, editions: [] });
      expect(await provider.lookupById('the-name-of-the-wind')).toBeNull();
    });
  });
});
