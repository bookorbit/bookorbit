import { Test, TestingModule } from '@nestjs/testing';
import { ProviderConfigurations } from '@bookorbit/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { ProviderThrottleError } from '../../provider-throttle.error';
import { MangabakaClient } from './mangabaka.client';
import { MangabakaProvider } from './mangabaka.provider';
import { MangabakaCollection, MangabakaSeries, MangabakaWork } from './mangabaka.types';

const enabledConfig: ProviderConfigurations = {
  google: { enabled: false, apiKey: '' },
  amazon: { enabled: false, domain: 'amazon.com', cookie: '' },
  goodreads: { enabled: false },
  hardcover: { enabled: false, apiKey: '' },
  openLibrary: { enabled: false },
  itunes: { enabled: false, coverResolution: 'high' },
  audible: { enabled: false, domain: 'com' },
  audnexus: { enabled: false },
  librofm: { enabled: false },
  comicvine: { enabled: false, apiKey: '' },
  ranobedb: { enabled: false },
  kobo: { enabled: false, country: 'us', language: 'en' },
  lubimyczytac: { enabled: false },
  aladin: { enabled: false, ttbKey: '' },
  mangabaka: { enabled: true },
};

const disabledConfig: ProviderConfigurations = {
  ...enabledConfig,
  mangabaka: { enabled: false },
};

const mockSeries: MangabakaSeries = {
  id: 1,
  state: 'active',
  merged_with: null,
  title: 'DICE',
  native_title: '다이스',
  romanized_title: 'DICE',
  secondary_titles: null,
  cover: null,
  authors: ['Hyun-Seok Yun'],
  artists: ['Hyun-Seok Yun'],
  description: 'A manga about dice.',
  year: 2013,
  published: {
    start_date: '2013-05-18',
    end_date: '2021-07-17',
    start_date_is_estimated: false,
    end_date_is_estimated: false,
  },
  status: 'completed',
  is_licensed: true,
  has_anime: true,
  anime: null,
  content_rating: 'safe',
  type: 'manhwa',
  rating: 70.3,
  popularity: null,
  final_volume: null,
  total_chapters: '388',
  links: [],
  links_v2: [],
  publishers: [{ name: 'LINE Webtoon', type: 'English', note: '' }],
  titles: [{ language: 'en', traits: ['official'], title: 'Dice', note: null, is_primary: true }],
  genres_v2: null,
  genres: ['action', 'drama'],
  tags_v2: [],
  tags: [],
  last_updated_at: '2026-01-01T00:00:00Z',
  relationships: null,
  relationships_v2: [],
  source: null,
};

describe('MangabakaProvider', () => {
  let provider: MangabakaProvider;
  let client: MangabakaClient;
  let providerConfig: ProviderConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MangabakaProvider,
        {
          provide: MangabakaClient,
          useValue: {
            search: vi.fn().mockResolvedValue([]),
            match: vi.fn().mockResolvedValue([]),
            fetchSeries: vi.fn().mockResolvedValue(null),
            fetchCollections: vi.fn().mockResolvedValue([]),
            fetchWorks: vi.fn().mockResolvedValue([]),
            fetchWork: vi.fn().mockResolvedValue(null),
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

    provider = module.get(MangabakaProvider);
    client = module.get(MangabakaClient);
    providerConfig = module.get(ProviderConfigService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('provider metadata', () => {
    it('has key MANGABAKA', () => {
      expect(provider.key).toBe('mangabaka');
    });

    it('has label MangaBaka', () => {
      expect(provider.label).toBe('MangaBaka');
    });

    it('is identifiable', () => {
      expect(provider.identifiable).toBe(true);
    });
  });

  describe('search()', () => {
    it('returns empty array when provider is disabled', async () => {
      vi.mocked(providerConfig.getConfig).mockResolvedValue(disabledConfig);
      const result = await provider.search({ title: 'DICE' });
      expect(result).toEqual([]);
      expect(client.search).not.toHaveBeenCalled();
      expect(client.match).not.toHaveBeenCalled();
    });

    it('returns empty array when no title and no author', async () => {
      const result = await provider.search({});
      expect(result).toEqual([]);
      expect(client.search).not.toHaveBeenCalled();
      expect(client.match).not.toHaveBeenCalled();
    });

    it('returns empty array when query is empty after cleaning', async () => {
      const result = await provider.search({ title: '[Manga FR] [Digital-1246]' });
      expect(result).toEqual([]);
      expect(client.search).not.toHaveBeenCalled();
      expect(client.match).not.toHaveBeenCalled();
    });

    it('searches by title when only title provided', async () => {
      vi.mocked(client.search).mockResolvedValue([mockSeries]);

      const result = await provider.search({ title: 'DICE' });

      expect(client.search).toHaveBeenCalledWith('DICE', 10, undefined);
      expect(client.match).not.toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].providerId).toBe('1');
    });

    it('searches by title only when both title and author provided', async () => {
      vi.mocked(client.search).mockResolvedValue([]);

      await provider.search({ title: 'DICE', author: 'Yun' });

      expect(client.search).toHaveBeenCalledWith('DICE', 10, undefined);
    });

    it('uses author alone when no title provided', async () => {
      vi.mocked(client.search).mockResolvedValue([]);

      await provider.search({ author: 'Yun' });

      expect(client.search).toHaveBeenCalledWith('Yun', 10, undefined);
    });

    it('respects maxCandidatesPerProvider', async () => {
      vi.mocked(client.search).mockResolvedValue([mockSeries]);

      await provider.search({ title: 'DICE', maxCandidatesPerProvider: 3 });

      expect(client.search).toHaveBeenCalledWith('DICE', 3, undefined);
    });

    it('returns empty array when both search and match return no results', async () => {
      vi.mocked(client.search).mockResolvedValue([]);
      vi.mocked(client.match).mockResolvedValue([]);

      const result = await provider.search({ title: 'unknown' });
      expect(result).toEqual([]);
      expect(client.match).toHaveBeenCalledWith('unknown', 10, undefined);
    });

    it('falls back to match when search returns no results', async () => {
      vi.mocked(client.search).mockResolvedValue([]);
      vi.mocked(client.match).mockResolvedValue([mockSeries]);

      const result = await provider.search({ title: 'DICE' });

      expect(client.search).toHaveBeenCalledWith('DICE', 10, undefined);
      expect(client.match).toHaveBeenCalledWith('DICE', 10, undefined);
      expect(result).toHaveLength(1);
      expect(result[0].providerId).toBe('1');
    });

    it('does not call match when search returns results', async () => {
      vi.mocked(client.search).mockResolvedValue([mockSeries]);

      await provider.search({ title: 'DICE' });

      expect(client.match).not.toHaveBeenCalled();
    });

    it('strips volume markers from title before searching', async () => {
      vi.mocked(client.search).mockResolvedValue([mockSeries]);

      await provider.search({ title: 'Death Note T09' });

      expect(client.search).toHaveBeenCalledWith('Death Note', 10, undefined);
    });

    it('strips volume markers and does not include author in query', async () => {
      vi.mocked(client.search).mockResolvedValue([]);

      await provider.search({ title: 'Death Note Vol. 9', author: 'Ohba' });

      expect(client.search).toHaveBeenCalledWith('Death Note', 10, undefined);
    });

    it('skips series where mapper returns null (id=0)', async () => {
      const zeroIdSeries: MangabakaSeries = { ...mockSeries, id: 0 };
      vi.mocked(client.search).mockResolvedValue([zeroIdSeries]);

      const result = await provider.search({ title: 'DICE' });
      expect(result).toEqual([]);
    });

    it('skips series where mapper returns null (merged_with)', async () => {
      const mergedSeries: MangabakaSeries = { ...mockSeries, merged_with: 42 };
      vi.mocked(client.search).mockResolvedValue([mergedSeries]);

      const result = await provider.search({ title: 'DICE' });
      expect(result).toEqual([]);
    });

    it('returns multiple candidates', async () => {
      const series2: MangabakaSeries = { ...mockSeries, id: 2 };
      vi.mocked(client.search).mockResolvedValue([mockSeries, series2]);

      const result = await provider.search({ title: 'DICE' });
      expect(result).toHaveLength(2);
    });

    it('passes signal to client', async () => {
      const controller = new AbortController();
      vi.mocked(client.search).mockResolvedValue([mockSeries]);

      await provider.search({ title: 'DICE', signal: controller.signal });

      expect(client.search).toHaveBeenCalledWith('DICE', 10, controller.signal);
    });

    it('passes signal to match on fallback', async () => {
      const controller = new AbortController();
      vi.mocked(client.search).mockResolvedValue([]);
      vi.mocked(client.match).mockResolvedValue([mockSeries]);

      await provider.search({ title: 'DICE', signal: controller.signal });

      expect(client.match).toHaveBeenCalledWith('DICE', 10, controller.signal);
    });

    it('with volume number: returns series candidates (no volume resolution)', async () => {
      vi.mocked(client.search).mockResolvedValue([mockSeries]);

      const result = await provider.search({ title: 'DICE T01' });

      expect(client.search).toHaveBeenCalledWith('DICE', 10, undefined);
      expect(client.fetchCollections).not.toHaveBeenCalled();
      expect(client.fetchWorks).not.toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].providerId).toBe('1');
    });

    it('with resolveVolumes and volume number: resolves to volume work', async () => {
      const mockCollection: MangabakaCollection = {
        id: 'col-1',
        series_id: 1,
        title: 'DICE Vol. 1',
        language: { iso: 'en', language: 'English' },
        publisher: { id: 1, type: 'publisher', sub_type: 'manga', aliases: null, parent_id: null, name: 'LINE Webtoon' },
        edition: { id: 'ed-1', name: 'Standard', language: { iso: 'en', language: 'English' }, description: '', override_text: null },
        type: 'volume',
        format: 'paged',
        medium: 'digital',
        status: 'published',
        reading: 'rtl',
        licensed: true,
        description: { desc: '', source: 'mangabaka' },
        note: null,
        start_date: null,
        end_date: null,
        links: [],
        related_collection_id: null,
        count_main: 10,
        count_extra: 0,
        count_other: 0,
        updated_at: '2024-01-01T00:00:00Z',
      };
      const mockWork: MangabakaWork = {
        id: '019e1d69-4210-767b-acd5-1de151bd138b',
        series_id: 1,
        source_ids: [],
        sub_title: 'Chapter 1',
        count_type: 'main',
        images: [],
        release_date: '2013-05-18',
        sequence_string: '1',
        sequence_numeric: 1,
        identifiers: [],
        trim: null,
        description: null,
        note: null,
        pages: 180,
        price: null,
        links: [],
        inc_chapters: null,
        part_of_volume: null,
        revision: null,
        updated_at: '2024-01-01T00:00:00Z',
        collections: [mockCollection],
      };
      vi.mocked(client.search).mockResolvedValue([mockSeries]);
      vi.mocked(client.fetchCollections).mockResolvedValue([mockCollection]);
      vi.mocked(client.fetchSeries).mockResolvedValue(mockSeries);
      vi.mocked(client.fetchWorks).mockResolvedValue([mockWork]);

      const result = await provider.search({ title: 'DICE T01', resolveVolumes: true });

      expect(client.search).toHaveBeenCalledWith('DICE', 10, undefined);
      expect(client.fetchCollections).toHaveBeenCalledWith(1, undefined);
      expect(client.fetchSeries).toHaveBeenCalledWith(1, undefined);
      expect(client.fetchWorks).toHaveBeenCalledWith('col-1', undefined);
      // Resolved volume replaces the series candidate
      expect(result).toHaveLength(1);
      expect(result[0].providerId).toBe('019e1d69-4210-767b-acd5-1de151bd138b');
      expect(result[0].mangabakaSeriesId).toBe('1');
      expect(result[0].seriesIndex).toBe('1');
    });

    it('with resolveVolumes and multiple series: keeps remaining series candidates', async () => {
      const series2: MangabakaSeries = {
        ...mockSeries,
        id: 2,
        titles: [{ language: 'en', traits: ['official'], title: 'Other Series', note: null, is_primary: true }],
      };
      const mockCollection: MangabakaCollection = {
        id: 'col-1',
        series_id: 1,
        title: 'DICE Vol. 1',
        language: { iso: 'en', language: 'English' },
        publisher: { id: 1, type: 'publisher', sub_type: 'manga', aliases: null, parent_id: null, name: 'LINE Webtoon' },
        edition: { id: 'ed-1', name: 'Standard', language: { iso: 'en', language: 'English' }, description: '', override_text: null },
        type: 'volume',
        format: 'paged',
        medium: 'digital',
        status: 'published',
        reading: 'rtl',
        licensed: true,
        description: { desc: '', source: 'mangabaka' },
        note: null,
        start_date: null,
        end_date: null,
        links: [],
        related_collection_id: null,
        count_main: 10,
        count_extra: 0,
        count_other: 0,
        updated_at: '2024-01-01T00:00:00Z',
      };
      const mockWork: MangabakaWork = {
        id: '019e1d69-4210-767b-acd5-1de151bd138b',
        series_id: 1,
        source_ids: [],
        sub_title: 'Chapter 1',
        count_type: 'main',
        images: [],
        release_date: null,
        sequence_string: '1',
        sequence_numeric: 1,
        identifiers: [],
        trim: null,
        description: null,
        note: null,
        pages: null,
        price: null,
        links: [],
        inc_chapters: null,
        part_of_volume: null,
        revision: null,
        updated_at: '2024-01-01T00:00:00Z',
        collections: [mockCollection],
      };
      vi.mocked(client.search).mockResolvedValue([mockSeries, series2]);
      vi.mocked(client.fetchCollections).mockResolvedValue([mockCollection]);
      vi.mocked(client.fetchSeries).mockResolvedValue(mockSeries);
      vi.mocked(client.fetchWorks).mockResolvedValue([mockWork]);

      const result = await provider.search({ title: 'DICE T01', resolveVolumes: true });

      // Resolved volume replaces first series, remaining series kept
      expect(result).toHaveLength(2);
      expect(result[0].providerId).toBe('019e1d69-4210-767b-acd5-1de151bd138b');
      expect(result[0].mangabakaSeriesId).toBe('1');
      expect(result[1].providerId).toBe('2');
    });

    it('with resolveVolumes and preferredLanguage: threads language through to pickBestCollection', async () => {
      const frCollection: MangabakaCollection = {
        id: 'col-fr',
        series_id: 1,
        title: 'DICE Vol. 1 FR',
        language: { iso: 'fr', language: 'French' },
        publisher: { id: 1, type: 'publisher', sub_type: 'manga', aliases: null, parent_id: null, name: 'Kurokawa' },
        edition: { id: 'ed-1', name: 'Standard', language: { iso: 'fr', language: 'French' }, description: '', override_text: null },
        type: 'volume',
        format: 'paged',
        medium: 'digital',
        status: 'published',
        reading: 'rtl',
        licensed: true,
        description: { desc: '', source: 'mangabaka' },
        note: null,
        start_date: null,
        end_date: null,
        links: [],
        related_collection_id: null,
        count_main: 10,
        count_extra: 0,
        count_other: 0,
        updated_at: '2024-01-01T00:00:00Z',
      };
      const enCollection: MangabakaCollection = {
        ...frCollection,
        id: 'col-en',
        language: { iso: 'en', language: 'English' },
        publisher: { id: 2, type: 'publisher', sub_type: 'manga', aliases: null, parent_id: null, name: 'LINE Webtoon' },
      };
      const frWork: MangabakaWork = {
        id: '019e1d69-4210-767b-acd5-1de151bd138b',
        series_id: 1,
        source_ids: [],
        sub_title: null,
        count_type: 'main',
        images: [],
        release_date: null,
        sequence_string: '1',
        sequence_numeric: 1,
        identifiers: [],
        trim: null,
        description: null,
        note: null,
        pages: null,
        price: null,
        links: [],
        inc_chapters: null,
        part_of_volume: null,
        revision: null,
        updated_at: '2024-01-01T00:00:00Z',
        collections: [frCollection, enCollection],
      };

      vi.mocked(client.search).mockResolvedValue([mockSeries]);
      vi.mocked(client.fetchCollections).mockResolvedValue([frCollection, enCollection]);
      vi.mocked(client.fetchSeries).mockResolvedValue(mockSeries);
      vi.mocked(client.fetchWorks).mockResolvedValue([frWork]);

      const result = await provider.search({ title: 'DICE T01', resolveVolumes: true, preferredLanguage: 'fr' });

      expect(result).toHaveLength(1);
      // Should pick French collection -> French publisher
      expect(result[0].publisher).toBe('Kurokawa');
    });

    it('with resolveVolumes and language hint in title: auto-detects preferredLanguage from [Manga FR]', async () => {
      const frCollection: MangabakaCollection = {
        id: 'col-fr',
        series_id: 1,
        title: 'DICE Vol. 1 FR',
        language: { iso: 'fr', language: 'French' },
        publisher: { id: 1, type: 'publisher', sub_type: 'manga', aliases: null, parent_id: null, name: 'Kurokawa' },
        edition: { id: 'ed-1', name: 'Standard', language: { iso: 'fr', language: 'French' }, description: '', override_text: null },
        type: 'volume',
        format: 'paged',
        medium: 'digital',
        status: 'published',
        reading: 'rtl',
        licensed: true,
        description: { desc: '', source: 'mangabaka' },
        note: null,
        start_date: null,
        end_date: null,
        links: [],
        related_collection_id: null,
        count_main: 10,
        count_extra: 0,
        count_other: 0,
        updated_at: '2024-01-01T00:00:00Z',
      };
      const enCollection: MangabakaCollection = {
        ...frCollection,
        id: 'col-en',
        language: { iso: 'en', language: 'English' },
        publisher: { id: 2, type: 'publisher', sub_type: 'manga', aliases: null, parent_id: null, name: 'LINE Webtoon' },
      };
      const frWork: MangabakaWork = {
        id: '019e1d69-4210-767b-acd5-1de151bd138b',
        series_id: 1,
        source_ids: [],
        sub_title: null,
        count_type: 'main',
        images: [],
        release_date: null,
        sequence_string: '1',
        sequence_numeric: 1,
        identifiers: [],
        trim: null,
        description: null,
        note: null,
        pages: null,
        price: null,
        links: [],
        inc_chapters: null,
        part_of_volume: null,
        revision: null,
        updated_at: '2024-01-01T00:00:00Z',
        collections: [frCollection, enCollection],
      };

      vi.mocked(client.search).mockResolvedValue([mockSeries]);
      vi.mocked(client.fetchCollections).mockResolvedValue([frCollection, enCollection]);
      vi.mocked(client.fetchSeries).mockResolvedValue(mockSeries);
      vi.mocked(client.fetchWorks).mockResolvedValue([frWork]);

      // No preferredLanguage param — should detect "fr" from [Manga FR] in the title
      const result = await provider.search({ title: 'DICE T01 [Manga FR]', resolveVolumes: true });

      expect(result).toHaveLength(1);
      expect(result[0].publisher).toBe('Kurokawa');
    });

    it('with resolveVolumes but no volume number: does not resolve', async () => {
      vi.mocked(client.search).mockResolvedValue([mockSeries]);

      const result = await provider.search({ title: 'DICE', resolveVolumes: true });

      expect(client.fetchCollections).not.toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].providerId).toBe('1');
    });

    it('with resolveVolumes but volume not found in collections: falls back to series', async () => {
      const mockCollection: MangabakaCollection = {
        id: 'col-1',
        series_id: 1,
        title: 'DICE Vol. 1',
        language: { iso: 'en', language: 'English' },
        publisher: { id: 1, type: 'publisher', sub_type: 'manga', aliases: null, parent_id: null, name: 'LINE Webtoon' },
        edition: { id: 'ed-1', name: 'Standard', language: { iso: 'en', language: 'English' }, description: '', override_text: null },
        type: 'volume',
        format: 'paged',
        medium: 'digital',
        status: 'published',
        reading: 'rtl',
        licensed: true,
        description: { desc: '', source: 'mangabaka' },
        note: null,
        start_date: null,
        end_date: null,
        links: [],
        related_collection_id: null,
        count_main: 10,
        count_extra: 0,
        count_other: 0,
        updated_at: '2024-01-01T00:00:00Z',
      };
      // Work with volume 1, but we search for volume 99
      const mockWork: MangabakaWork = {
        id: '019e1d69-4210-767b-acd5-1de151bd138b',
        series_id: 1,
        source_ids: [],
        sub_title: null,
        count_type: 'main',
        images: [],
        release_date: null,
        sequence_string: '1',
        sequence_numeric: 1,
        identifiers: [],
        trim: null,
        description: null,
        note: null,
        pages: null,
        price: null,
        links: [],
        inc_chapters: null,
        part_of_volume: null,
        revision: null,
        updated_at: '2024-01-01T00:00:00Z',
        collections: [mockCollection],
      };
      vi.mocked(client.search).mockResolvedValue([mockSeries]);
      vi.mocked(client.fetchCollections).mockResolvedValue([mockCollection]);
      vi.mocked(client.fetchSeries).mockResolvedValue(mockSeries);
      vi.mocked(client.fetchWorks).mockResolvedValue([mockWork]);

      const result = await provider.search({ title: 'DICE Vol. 99', resolveVolumes: true });

      // Volume 99 not found in works, falls back to series
      expect(result).toHaveLength(1);
      expect(result[0].providerId).toBe('1');
    });

    it('with resolveVolumes but fetchCollections fails: falls back to series', async () => {
      vi.mocked(client.search).mockResolvedValue([mockSeries]);
      vi.mocked(client.fetchCollections).mockRejectedValue(new Error('network error'));

      const result = await provider.search({ title: 'DICE T01', resolveVolumes: true });

      // Falls back gracefully
      expect(result).toHaveLength(1);
      expect(result[0].providerId).toBe('1');
    });

    it('without volume number: returns series candidates without collection/work fetch', async () => {
      vi.mocked(client.search).mockResolvedValue([mockSeries]);

      const result = await provider.search({ title: 'DICE' });

      expect(client.fetchCollections).not.toHaveBeenCalled();
      expect(client.fetchWorks).not.toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].providerId).toBe('1');
    });

    it('with volume number but empty series list: no collection/work fetch', async () => {
      vi.mocked(client.search).mockResolvedValue([]);
      vi.mocked(client.match).mockResolvedValue([]);

      const result = await provider.search({ title: 'DICE T01' });

      expect(client.fetchCollections).not.toHaveBeenCalled();
      expect(client.fetchWorks).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe('fetchSeriesCollections()', () => {
    const mockCollection: MangabakaCollection = {
      id: 'col-1',
      series_id: 1,
      title: 'DICE Vol. 1',
      language: { iso: 'en', language: 'English' },
      publisher: { id: 1, type: 'publisher', sub_type: 'manga', aliases: null, parent_id: null, name: 'LINE Webtoon' },
      edition: { id: 'ed-1', name: 'Standard', language: { iso: 'en', language: 'English' }, description: '', override_text: null },
      type: 'volume',
      format: 'paged',
      medium: 'digital',
      status: 'published',
      reading: 'rtl',
      licensed: true,
      description: { desc: '', source: 'mangabaka' },
      note: null,
      start_date: null,
      end_date: null,
      links: [],
      related_collection_id: null,
      count_main: 10,
      count_extra: 0,
      count_other: 0,
      updated_at: '2024-01-01T00:00:00Z',
    };

    it('returns mapped summaries, filters empty collections', async () => {
      const emptyCollection: MangabakaCollection = { ...mockCollection, id: 'col-empty', count_main: 0 };
      vi.mocked(client.fetchCollections).mockResolvedValue([mockCollection, emptyCollection]);

      const result = await provider.fetchSeriesCollections(1);

      expect(client.fetchCollections).toHaveBeenCalledWith(1, undefined);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'col-1',
        title: 'DICE Vol. 1',
        language: 'en',
        languageDisplay: 'English',
        publisher: 'LINE Webtoon',
        medium: 'digital',
        type: 'volume',
        countMain: 10,
        countExtra: 0,
        countOther: 0,
      });
    });

    it('returns [] when provider disabled', async () => {
      vi.mocked(providerConfig.getConfig).mockResolvedValue(disabledConfig);

      const result = await provider.fetchSeriesCollections(1);

      expect(result).toEqual([]);
      expect(client.fetchCollections).not.toHaveBeenCalled();
    });

    it('passes signal to client', async () => {
      const controller = new AbortController();
      vi.mocked(client.fetchCollections).mockResolvedValue([mockCollection]);

      await provider.fetchSeriesCollections(1, controller.signal);

      expect(client.fetchCollections).toHaveBeenCalledWith(1, controller.signal);
    });

    it('propagates ProviderThrottleError from client', async () => {
      vi.mocked(client.fetchCollections).mockRejectedValue(new ProviderThrottleError(5000));

      await expect(provider.fetchSeriesCollections(1)).rejects.toThrow(ProviderThrottleError);
    });
  });

  describe('fetchCollectionWorks()', () => {
    const mockCollection: MangabakaCollection = {
      id: 'col-1',
      series_id: 1,
      title: 'DICE Vol. 1',
      language: { iso: 'en', language: 'English' },
      publisher: { id: 1, type: 'publisher', sub_type: 'manga', aliases: null, parent_id: null, name: 'LINE Webtoon' },
      edition: { id: 'ed-1', name: 'Standard', language: { iso: 'en', language: 'English' }, description: '', override_text: null },
      type: 'volume',
      format: 'paged',
      medium: 'digital',
      status: 'published',
      reading: 'rtl',
      licensed: true,
      description: { desc: '', source: 'mangabaka' },
      note: null,
      start_date: null,
      end_date: null,
      links: [],
      related_collection_id: null,
      count_main: 10,
      count_extra: 0,
      count_other: 0,
      updated_at: '2024-01-01T00:00:00Z',
    };
    const mockWork: MangabakaWork = {
      id: '019e1d69-4210-767b-acd5-1de151bd138b',
      series_id: 1,
      source_ids: [],
      sub_title: null,
      count_type: 'main',
      images: [],
      release_date: null,
      sequence_string: '1',
      sequence_numeric: 1,
      identifiers: [],
      trim: null,
      description: null,
      note: null,
      pages: null,
      price: null,
      links: [],
      inc_chapters: null,
      part_of_volume: null,
      revision: null,
      updated_at: '2024-01-01T00:00:00Z',
      collections: [mockCollection],
    };

    it('returns mapped work candidates', async () => {
      vi.mocked(client.fetchSeries).mockResolvedValue(mockSeries);
      vi.mocked(client.fetchWorks).mockResolvedValue([mockWork]);

      const result = await provider.fetchCollectionWorks('col-1', 1);

      expect(client.fetchSeries).toHaveBeenCalledWith(1, undefined);
      expect(client.fetchWorks).toHaveBeenCalledWith('col-1', undefined);
      expect(result).toHaveLength(1);
      expect(result[0].providerId).toBe('019e1d69-4210-767b-acd5-1de151bd138b');
    });

    it('returns [] when provider disabled', async () => {
      vi.mocked(providerConfig.getConfig).mockResolvedValue(disabledConfig);

      const result = await provider.fetchCollectionWorks('col-1', 1);

      expect(result).toEqual([]);
      expect(client.fetchSeries).not.toHaveBeenCalled();
      expect(client.fetchWorks).not.toHaveBeenCalled();
    });

    it('returns [] when series not found', async () => {
      vi.mocked(client.fetchSeries).mockResolvedValue(null);

      const result = await provider.fetchCollectionWorks('col-1', 1);

      expect(result).toEqual([]);
      expect(client.fetchWorks).not.toHaveBeenCalled();
    });

    it('filters to count_type main only', async () => {
      const extraWork: MangabakaWork = { ...mockWork, id: 'extra-id', count_type: 'extra' };
      vi.mocked(client.fetchSeries).mockResolvedValue(mockSeries);
      vi.mocked(client.fetchWorks).mockResolvedValue([mockWork, extraWork]);

      const result = await provider.fetchCollectionWorks('col-1', 1);

      expect(result).toHaveLength(1);
      expect(result[0].providerId).toBe('019e1d69-4210-767b-acd5-1de151bd138b');
    });

    it('passes signal to client', async () => {
      const controller = new AbortController();
      vi.mocked(client.fetchSeries).mockResolvedValue(mockSeries);
      vi.mocked(client.fetchWorks).mockResolvedValue([mockWork]);

      await provider.fetchCollectionWorks('col-1', 1, undefined, controller.signal);

      expect(client.fetchSeries).toHaveBeenCalledWith(1, controller.signal);
      expect(client.fetchWorks).toHaveBeenCalledWith('col-1', controller.signal);
    });

    it('passes preferredLanguage to mapMangabakaWork', async () => {
      vi.mocked(client.fetchSeries).mockResolvedValue(mockSeries);
      vi.mocked(client.fetchWorks).mockResolvedValue([mockWork]);

      const result = await provider.fetchCollectionWorks('col-1', 1, 'fr');

      expect(result).toHaveLength(1);
      expect(result[0].providerId).toBe('019e1d69-4210-767b-acd5-1de151bd138b');
    });

    it('propagates ProviderThrottleError from fetchWorks', async () => {
      vi.mocked(client.fetchSeries).mockResolvedValue(mockSeries);
      vi.mocked(client.fetchWorks).mockRejectedValue(new ProviderThrottleError(5000));

      await expect(provider.fetchCollectionWorks('col-1', 1)).rejects.toThrow(ProviderThrottleError);
    });
  });

  describe('lookupById()', () => {
    const validUuid = '019e1d69-4210-767b-acd5-1de151bd138b';

    it('returns null when provider is disabled', async () => {
      vi.mocked(providerConfig.getConfig).mockResolvedValue(disabledConfig);
      const result = await provider.lookupById(validUuid);
      expect(result).toBeNull();
    });

    it('returns null for non-UUID non-numeric ID', async () => {
      const result = await provider.lookupById('abc');
      expect(result).toBeNull();
      expect(client.fetchWork).not.toHaveBeenCalled();
      expect(client.fetchSeries).not.toHaveBeenCalled();
    });

    it('treats numeric ID as series ID and returns mapped candidate', async () => {
      vi.mocked(client.fetchSeries).mockResolvedValue(mockSeries);

      const result = await provider.lookupById('123');
      expect(result).not.toBeNull();
      expect(result?.providerId).toBe('1');
      expect(client.fetchSeries).toHaveBeenCalledWith(123, undefined);
      expect(client.fetchWork).not.toHaveBeenCalled();
    });

    it('returns null for numeric ID when fetchSeries returns null', async () => {
      vi.mocked(client.fetchSeries).mockResolvedValue(null);

      const result = await provider.lookupById('123');
      expect(result).toBeNull();
      expect(client.fetchSeries).toHaveBeenCalledWith(123, undefined);
    });

    it('accepts UUID without hyphens', async () => {
      const noHyphenUuid = '019e1d694210767bacd51de151bd138b';
      const mockWork: MangabakaWork = {
        id: noHyphenUuid,
        series_id: 1,
        source_ids: [],
        sub_title: null,
        count_type: 'main',
        images: [],
        release_date: null,
        sequence_string: '1',
        sequence_numeric: 1,
        identifiers: [],
        trim: null,
        description: null,
        note: null,
        pages: null,
        price: null,
        links: [],
        inc_chapters: null,
        part_of_volume: null,
        revision: null,
        updated_at: '2024-01-01T00:00:00Z',
        collections: [],
      };
      vi.mocked(client.fetchWork).mockResolvedValue(mockWork);
      vi.mocked(client.fetchSeries).mockResolvedValue(mockSeries);

      const result = await provider.lookupById(noHyphenUuid);
      expect(result).not.toBeNull();
      expect(client.fetchWork).toHaveBeenCalledWith(noHyphenUuid, undefined);
    });

    it('returns null for empty string ID', async () => {
      const result = await provider.lookupById('');
      expect(result).toBeNull();
    });

    it('returns null when fetchWork returns null', async () => {
      vi.mocked(client.fetchWork).mockResolvedValue(null);
      const result = await provider.lookupById(validUuid);
      expect(result).toBeNull();
    });

    it('returns null when fetchSeries returns null after work found', async () => {
      const mockWork: MangabakaWork = {
        id: validUuid,
        series_id: 1,
        source_ids: [],
        sub_title: null,
        count_type: 'main',
        images: [],
        release_date: null,
        sequence_string: '1',
        sequence_numeric: 1,
        identifiers: [],
        trim: null,
        description: null,
        note: null,
        pages: null,
        price: null,
        links: [],
        inc_chapters: null,
        part_of_volume: null,
        revision: null,
        updated_at: '2024-01-01T00:00:00Z',
        collections: [],
      };
      vi.mocked(client.fetchWork).mockResolvedValue(mockWork);
      vi.mocked(client.fetchSeries).mockResolvedValue(null);

      const result = await provider.lookupById(validUuid);
      expect(result).toBeNull();
    });

    it('returns mapped candidate for valid UUID', async () => {
      const mockWork: MangabakaWork = {
        id: validUuid,
        series_id: 1,
        source_ids: [],
        sub_title: null,
        count_type: 'main',
        images: [],
        release_date: null,
        sequence_string: '1',
        sequence_numeric: 1,
        identifiers: [],
        trim: null,
        description: null,
        note: null,
        pages: null,
        price: null,
        links: [],
        inc_chapters: null,
        part_of_volume: null,
        revision: null,
        updated_at: '2024-01-01T00:00:00Z',
        collections: [],
      };
      vi.mocked(client.fetchWork).mockResolvedValue(mockWork);
      vi.mocked(client.fetchSeries).mockResolvedValue(mockSeries);

      const result = await provider.lookupById(validUuid);
      expect(result).not.toBeNull();
      expect(result?.providerId).toBe(validUuid);
      expect(result?.title).toBe('Dice, Vol. 01');
    });

    it('calls fetchWork with correct UUID', async () => {
      vi.mocked(client.fetchWork).mockResolvedValue({
        id: validUuid,
        series_id: 1,
        source_ids: [],
        sub_title: null,
        count_type: 'main',
        images: [],
        release_date: null,
        sequence_string: '1',
        sequence_numeric: 1,
        identifiers: [],
        trim: null,
        description: null,
        note: null,
        pages: null,
        price: null,
        links: [],
        inc_chapters: null,
        part_of_volume: null,
        revision: null,
        updated_at: '2024-01-01T00:00:00Z',
        collections: [],
      });
      vi.mocked(client.fetchSeries).mockResolvedValue(mockSeries);
      await provider.lookupById(validUuid);
      expect(client.fetchWork).toHaveBeenCalledWith(validUuid, undefined);
    });

    it('passes signal to fetchWork and fetchSeries', async () => {
      const controller = new AbortController();
      const mockWork: MangabakaWork = {
        id: validUuid,
        series_id: 1,
        source_ids: [],
        sub_title: null,
        count_type: 'main',
        images: [],
        release_date: null,
        sequence_string: '1',
        sequence_numeric: 1,
        identifiers: [],
        trim: null,
        description: null,
        note: null,
        pages: null,
        price: null,
        links: [],
        inc_chapters: null,
        part_of_volume: null,
        revision: null,
        updated_at: '2024-01-01T00:00:00Z',
        collections: [],
      };
      vi.mocked(client.fetchWork).mockResolvedValue(mockWork);
      vi.mocked(client.fetchSeries).mockResolvedValue(mockSeries);
      await provider.lookupById(validUuid, controller.signal);
      expect(client.fetchWork).toHaveBeenCalledWith(validUuid, controller.signal);
      expect(client.fetchSeries).toHaveBeenCalledWith(1, controller.signal);
    });
  });
});
