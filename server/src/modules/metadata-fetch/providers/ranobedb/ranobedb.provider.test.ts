import { Test, TestingModule } from '@nestjs/testing';
import { ProviderConfigurations } from '@bookorbit/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { RanobeDbClient } from './ranobedb.client';
import { RanobeDbProvider } from './ranobedb.provider';
import { RanobeDbBook } from './ranobedb.types';

const enabledConfig: ProviderConfigurations = {
  google: { enabled: false, apiKey: '' },
  amazon: { enabled: false, domain: 'amazon.com', cookie: '' },
  goodreads: { enabled: false },
  hardcover: { enabled: false, apiKey: '' },
  openLibrary: { enabled: false },
  itunes: { enabled: false, coverResolution: 'high' },
  audible: { enabled: false, domain: 'com' },
  audnexus: { enabled: false },
  comicvine: { enabled: false, apiKey: '' },
  ranobedb: { enabled: true },
};

const disabledConfig: ProviderConfigurations = {
  ...enabledConfig,
  ranobedb: { enabled: false },
};

const mockBook: RanobeDbBook = {
  id: 1287,
  title: 'ソードアート・オンライン',
  romaji: 'Sword Art Online',
  lang: 'ja',
  c_release_date: 20120710,
  image: { id: 10, filename: 'covers/sao.jpg', width: 300, height: 450, nsfw: false, spoiler: false },
  rating: null,
  titles: [{ book_id: 1287, lang: 'en', official: true, title: 'Sword Art Online Vol. 1', romaji: null }],
  editions: [
    {
      book_id: 1287,
      lang: 'en',
      title: 'EN Edition',
      eid: 1,
      staff: [{ role_type: 'author', romaji: 'Reki Kawahara', name: '川原礫', staff_id: 1 }],
    },
  ],
  releases: [{ lang: 'en', id: 100, title: null, release_date: 20121210, isbn13: '9780316371247', pages: 240, format: 'print' }],
  publishers: [{ lang: 'en', id: 10, romaji: null, name: 'Yen Press', publisher_type: 'publisher' }],
  series: { id: 50, title: 'Sword Art Online', romaji: null, books: [{ id: 1287, lang: null, title: null, romaji: null, image: null }], tags: [] },
};

describe('RanobeDbProvider', () => {
  let provider: RanobeDbProvider;
  let client: RanobeDbClient;
  let providerConfig: ProviderConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RanobeDbProvider,
        {
          provide: RanobeDbClient,
          useValue: {
            search: vi.fn().mockResolvedValue([]),
            fetchBook: vi.fn().mockResolvedValue(null),
          },
        },
        {
          provide: ProviderConfigService,
          useValue: {
            getConfig: vi.fn().mockResolvedValue(enabledConfig),
          },
        },
      ],
    }).compile();

    provider = module.get(RanobeDbProvider);
    client = module.get(RanobeDbClient);
    providerConfig = module.get(ProviderConfigService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('provider metadata', () => {
    it('has key RANOBEDB', () => {
      expect(provider.key).toBe('ranobedb');
    });

    it('has label RanobeDB', () => {
      expect(provider.label).toBe('RanobeDB');
    });

    it('is identifiable', () => {
      expect(provider.identifiable).toBe(true);
    });
  });

  describe('search()', () => {
    it('returns empty array when provider is disabled', async () => {
      vi.mocked(providerConfig.getConfig).mockResolvedValue(disabledConfig);
      const result = await provider.search({ title: 'SAO' });
      expect(result).toEqual([]);
      expect(client.search).not.toHaveBeenCalled();
    });

    it('returns empty array when no title and no author', async () => {
      const result = await provider.search({});
      expect(result).toEqual([]);
      expect(client.search).not.toHaveBeenCalled();
    });

    it('searches by title when only title provided', async () => {
      vi.mocked(client.search).mockResolvedValue([1287]);
      vi.mocked(client.fetchBook).mockResolvedValue({ book: mockBook });

      const result = await provider.search({ title: 'Sword Art Online' });

      expect(client.search).toHaveBeenCalledWith('Sword Art Online', undefined);
      expect(result).toHaveLength(1);
      expect(result[0].providerId).toBe('1287');
    });

    it('combines title and author in query', async () => {
      vi.mocked(client.search).mockResolvedValue([]);

      await provider.search({ title: 'SAO', author: 'Kawahara' });

      expect(client.search).toHaveBeenCalledWith('SAO Kawahara', undefined);
    });

    it('uses author alone when no title provided', async () => {
      vi.mocked(client.search).mockResolvedValue([]);

      await provider.search({ author: 'Kawahara' });

      expect(client.search).toHaveBeenCalledWith('Kawahara', undefined);
    });

    it('returns empty array when client.search returns no IDs', async () => {
      vi.mocked(client.search).mockResolvedValue([]);

      const result = await provider.search({ title: 'unknown' });
      expect(result).toEqual([]);
    });

    it('skips null candidates from fetchBook', async () => {
      vi.mocked(client.search).mockResolvedValue([1287, 9999]);
      vi.mocked(client.fetchBook).mockResolvedValueOnce({ book: mockBook }).mockResolvedValueOnce(null);

      const result = await provider.search({ title: 'SAO' });
      expect(result).toHaveLength(1);
    });

    it('skips books where fetchBook returns null book.id (mapper returns null)', async () => {
      const zeroIdBook: RanobeDbBook = { ...mockBook, id: 0 };
      vi.mocked(client.search).mockResolvedValue([0]);
      vi.mocked(client.fetchBook).mockResolvedValue({ book: zeroIdBook });

      const result = await provider.search({ title: 'SAO' });
      expect(result).toEqual([]);
    });

    it('returns multiple candidates', async () => {
      const book2: RanobeDbBook = { ...mockBook, id: 1288 };
      vi.mocked(client.search).mockResolvedValue([1287, 1288]);
      vi.mocked(client.fetchBook).mockResolvedValueOnce({ book: mockBook }).mockResolvedValueOnce({ book: book2 });

      const result = await provider.search({ title: 'SAO' });
      expect(result).toHaveLength(2);
    });

    it('passes signal to client', async () => {
      const controller = new AbortController();
      vi.mocked(client.search).mockResolvedValue([1287]);
      vi.mocked(client.fetchBook).mockResolvedValue({ book: mockBook });

      await provider.search({ title: 'SAO', signal: controller.signal });

      expect(client.search).toHaveBeenCalledWith('SAO', controller.signal);
      expect(client.fetchBook).toHaveBeenCalledWith(1287, controller.signal);
    });
  });

  describe('lookupById()', () => {
    it('returns null when provider is disabled', async () => {
      vi.mocked(providerConfig.getConfig).mockResolvedValue(disabledConfig);
      const result = await provider.lookupById('1287');
      expect(result).toBeNull();
    });

    it('returns null for non-numeric ID', async () => {
      const result = await provider.lookupById('abc');
      expect(result).toBeNull();
      expect(client.fetchBook).not.toHaveBeenCalled();
    });

    it('returns null for ID with trailing non-numeric characters', async () => {
      const result = await provider.lookupById('123abc');
      expect(result).toBeNull();
      expect(client.fetchBook).not.toHaveBeenCalled();
    });

    it('returns null for empty string ID', async () => {
      const result = await provider.lookupById('');
      expect(result).toBeNull();
    });

    it('returns null for ID with leading/trailing spaces', async () => {
      const result = await provider.lookupById(' 123 ');
      expect(result).toBeNull();
    });

    it('returns null when fetchBook returns null', async () => {
      vi.mocked(client.fetchBook).mockResolvedValue(null);
      const result = await provider.lookupById('1287');
      expect(result).toBeNull();
    });

    it('returns mapped candidate for valid numeric ID', async () => {
      vi.mocked(client.fetchBook).mockResolvedValue({ book: mockBook });
      const result = await provider.lookupById('1287');
      expect(result).not.toBeNull();
      expect(result?.providerId).toBe('1287');
      expect(result?.title).toBe('Sword Art Online Vol. 1');
    });

    it('calls fetchBook with correct integer ID', async () => {
      vi.mocked(client.fetchBook).mockResolvedValue({ book: mockBook });
      await provider.lookupById('42');
      expect(client.fetchBook).toHaveBeenCalledWith(42, undefined);
    });

    it('passes signal to fetchBook', async () => {
      const controller = new AbortController();
      vi.mocked(client.fetchBook).mockResolvedValue({ book: mockBook });
      await provider.lookupById('1287', controller.signal);
      expect(client.fetchBook).toHaveBeenCalledWith(1287, controller.signal);
    });

    it('returns null for unsafe integer (overflow)', async () => {
      const unsafe = String(Number.MAX_SAFE_INTEGER + 1);
      const result = await provider.lookupById(unsafe);
      expect(result).toBeNull();
    });

    it('returns null when mapper returns null (book id=0)', async () => {
      const zeroIdBook: RanobeDbBook = { ...mockBook, id: 0 };
      vi.mocked(client.fetchBook).mockResolvedValue({ book: zeroIdBook });
      const result = await provider.lookupById('1287');
      expect(result).toBeNull();
    });
  });
});
