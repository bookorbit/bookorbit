import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as fetchWithThrottleModule from '../../fetch-with-throttle';
import { ProviderThrottleError } from '../../provider-throttle.error';
import { MangabakaClient } from './mangabaka.client';

vi.mock('../../fetch-with-throttle', () => ({
  fetchWithThrottle: vi.fn(),
}));

vi.mock('../provider-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../provider-utils')>();
  return {
    ...actual,
    sleep: vi.fn().mockResolvedValue(undefined),
    buildRequestSignal: vi.fn().mockReturnValue(new AbortController().signal),
  };
});

describe('MangabakaClient', () => {
  let client: MangabakaClient;
  let mockFetch: ReturnType<typeof vi.mocked<typeof fetchWithThrottleModule.fetchWithThrottle>>;

  beforeEach(() => {
    client = new MangabakaClient();
    mockFetch = vi.mocked(fetchWithThrottleModule.fetchWithThrottle);
    vi.clearAllMocks();
  });

  describe('match()', () => {
    it('returns array of series on success', async () => {
      const mockSeries = [
        { id: 1, title: 'DICE', state: 'active', merged_with: null, native_title: '다이스', romanized_title: 'DICE' },
        { id: 2, title: 'One Piece', state: 'active', merged_with: null, native_title: 'ワンピース', romanized_title: 'One Piece' },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 200, data: mockSeries }),
      } as Response);

      const result = await client.match('dice', 5);
      expect(result).toEqual(mockSeries);
    });

    it('builds query parameters correctly', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 200, data: [] }),
      } as Response);

      await client.match('one piece', 5);

      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/v1/series/match?'), expect.any(Object));
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('q=one'), expect.any(Object));
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('limit=5'), expect.any(Object));
    });

    it('sends correct User-Agent header', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 200, data: [] }),
      } as Response);

      await client.match('test', 5);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': expect.stringContaining('bookorbit'),
          }),
        }),
      );
    });

    it('returns empty array when response is not ok', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
      } as Response);

      const result = await client.match('query', 5);
      expect(result).toEqual([]);
    });

    it('returns empty array when fetch throws a generic error', async () => {
      mockFetch.mockRejectedValue(new Error('network failure'));

      const result = await client.match('query', 5);
      expect(result).toEqual([]);
    });

    it('rethrows ProviderThrottleError', async () => {
      mockFetch.mockRejectedValue(new ProviderThrottleError(1000));

      await expect(client.match('query', 5)).rejects.toThrow(ProviderThrottleError);
    });

    it('returns empty array when data field is missing', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 200 }),
      } as Response);

      const result = await client.match('query', 5);
      expect(result).toEqual([]);
    });
  });

  describe('search()', () => {
    it('returns array of series on success', async () => {
      const mockSeries = [
        { id: 1, title: 'NARUTO', state: 'active', merged_with: null, native_title: 'NARUTO―ナルト―', romanized_title: 'Naruto' },
        { id: 2, title: 'Boruto', state: 'active', merged_with: null, native_title: 'ボルト', romanized_title: 'Boruto' },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 200, data: mockSeries }),
      } as Response);

      const result = await client.search('naruto', 5);
      expect(result).toEqual(mockSeries);
    });

    it('builds query parameters correctly', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 200, data: [] }),
      } as Response);

      await client.search('one piece', 5);

      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/v1/series/search?'), expect.any(Object));
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('q=one'), expect.any(Object));
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('limit=5'), expect.any(Object));
    });

    it('returns empty array when response is not ok', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
      } as Response);

      const result = await client.search('query', 5);
      expect(result).toEqual([]);
    });

    it('returns empty array when fetch throws a generic error', async () => {
      mockFetch.mockRejectedValue(new Error('network failure'));

      const result = await client.search('query', 5);
      expect(result).toEqual([]);
    });

    it('rethrows ProviderThrottleError', async () => {
      mockFetch.mockRejectedValue(new ProviderThrottleError(1000));

      await expect(client.search('query', 5)).rejects.toThrow(ProviderThrottleError);
    });

    it('returns empty array when data field is missing', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 200 }),
      } as Response);

      const result = await client.search('query', 5);
      expect(result).toEqual([]);
    });
  });

  describe('fetchSeries()', () => {
    it('returns series response on success', async () => {
      const mockSeries = {
        id: 1,
        title: 'DICE',
        native_title: '다이스',
        romanized_title: 'DICE',
        authors: ['Hyun-Seok Yun'],
        artists: ['Hyun-Seok Yun'],
        description: 'A manga.',
        year: 2013,
        status: 'completed',
        type: 'manhwa',
        rating: 70.3,
        genres: ['action', 'drama'],
        tags: [],
        titles: [],
        publishers: [],
        links: [],
        links_v2: [],
        secondary_titles: null,
        cover: null,
        published: null,
        is_licensed: true,
        has_anime: true,
        anime: null,
        content_rating: 'safe',
        popularity: null,
        final_volume: null,
        total_chapters: '388',
        last_updated_at: '2026-01-01T00:00:00Z',
        relationships: null,
        relationships_v2: [],
        source: null,
        merged_with: null,
        genres_v2: null,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 200, data: mockSeries }),
      } as Response);

      const result = await client.fetchSeries(1);
      expect(result).toEqual(mockSeries);
    });

    it('calls correct URL', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 200, data: { id: 42 } }),
      } as Response);

      await client.fetchSeries(42);

      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/v1/series/42'), expect.any(Object));
    });

    it('returns null when response is not ok', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      const result = await client.fetchSeries(999);
      expect(result).toBeNull();
    });

    it('returns null when fetch throws a generic error', async () => {
      mockFetch.mockRejectedValue(new Error('timeout'));

      const result = await client.fetchSeries(1);
      expect(result).toBeNull();
    });

    it('rethrows ProviderThrottleError', async () => {
      mockFetch.mockRejectedValue(new ProviderThrottleError(1000));

      await expect(client.fetchSeries(1)).rejects.toThrow(ProviderThrottleError);
    });
  });

  describe('fetchCollections()', () => {
    it('returns array of collections on success', async () => {
      const mockCollections = [
        { id: 'col-1', series_id: 1, title: 'Naruto Vol. 1', type: 'volume' },
        { id: 'col-2', series_id: 1, title: 'Naruto Vol. 2', type: 'volume' },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 200, data: mockCollections }),
      } as Response);

      const result = await client.fetchCollections(1);
      expect(result).toEqual(mockCollections);
    });

    it('calls correct URL', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 200, data: [] }),
      } as Response);

      await client.fetchCollections(42);

      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/v1/series/42/collections'), expect.any(Object));
    });

    it('returns empty array when response is not ok', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      const result = await client.fetchCollections(999);
      expect(result).toEqual([]);
    });

    it('returns empty array when fetch throws a generic error', async () => {
      mockFetch.mockRejectedValue(new Error('timeout'));

      const result = await client.fetchCollections(1);
      expect(result).toEqual([]);
    });

    it('rethrows ProviderThrottleError', async () => {
      mockFetch.mockRejectedValue(new ProviderThrottleError(1000));

      await expect(client.fetchCollections(1)).rejects.toThrow(ProviderThrottleError);
    });

    it('uses cache on second call within TTL', async () => {
      const mockCollections = [{ id: 'col-1', series_id: 1, title: 'Naruto Vol. 1', type: 'volume' }];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 200, data: mockCollections }),
      } as Response);

      const result1 = await client.fetchCollections(1);
      expect(result1).toEqual(mockCollections);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call should use cache
      const result2 = await client.fetchCollections(1);
      expect(result2).toEqual(mockCollections);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('re-fetches after TTL expires', async () => {
      const mockCollections1 = [{ id: 'col-1', series_id: 1, title: 'Vol. 1', type: 'volume' }];
      const mockCollections2 = [{ id: 'col-2', series_id: 1, title: 'Vol. 2', type: 'volume' }];

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ status: 200, data: mockCollections1 }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ status: 200, data: mockCollections2 }),
        } as Response);

      const result1 = await client.fetchCollections(1);
      expect(result1).toEqual(mockCollections1);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Advance time past TTL (10 min = 600000ms)
      const realDateNow = Date.now;
      const now = realDateNow();
      vi.spyOn(Date, 'now').mockReturnValue(now + 600_001);

      const result2 = await client.fetchCollections(1);
      expect(result2).toEqual(mockCollections2);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      vi.restoreAllMocks();
    });

    it('LRU evicts oldest entry when cache exceeds max size', async () => {
      // Insert 501 entries - the oldest should be evicted
      for (let i = 0; i < 501; i++) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ status: 200, data: [{ id: `col-${i}`, series_id: i }] }),
        } as Response);
      }

      // Insert 501 entries
      for (let i = 0; i < 501; i++) {
        await client.fetchCollections(i);
      }

      // Entry 0 should be evicted, so fetching it again should hit the network
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 200, data: [{ id: 'col-reload', series_id: 0 }] }),
      } as Response);

      const result = await client.fetchCollections(0);
      expect(result).toEqual([{ id: 'col-reload', series_id: 0 }]);
      // 501 initial + 1 re-fetch = 502 total calls
      expect(mockFetch).toHaveBeenCalledTimes(502);
    });
  });

  describe('fetchWorks()', () => {
    it('returns array of works on success', async () => {
      const mockWorks = [
        { id: 'work-1', series_id: 1, sequence_numeric: 1 },
        { id: 'work-2', series_id: 1, sequence_numeric: 2 },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 200, data: mockWorks, pagination: { count: 2, page: 1, limit: 50, next: null, previous: null } }),
      } as Response);

      const result = await client.fetchWorks('col-1');
      expect(result).toEqual(mockWorks);
    });

    it('calls correct URL with limit and page', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 200, data: [], pagination: { count: 0, page: 1, limit: 50, next: null, previous: null } }),
      } as Response);

      await client.fetchWorks('col-1');

      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/v1/collections/col-1/works?limit=50&page=1'), expect.any(Object));
    });

    it('fetches all pages when pagination count exceeds limit', async () => {
      const page1Works = Array.from({ length: 50 }, (_, i) => ({ id: `work-${i}`, series_id: 1, sequence_numeric: i }));
      const page2Works = Array.from({ length: 25 }, (_, i) => ({ id: `work-${50 + i}`, series_id: 1, sequence_numeric: 50 + i }));

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({ status: 200, data: page1Works, pagination: { count: 75, page: 1, limit: 50, next: 'page=2', previous: null } }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({ status: 200, data: page2Works, pagination: { count: 75, page: 2, limit: 50, next: null, previous: 'page=1' } }),
        } as Response);

      const result = await client.fetchWorks('col-1');
      expect(result).toHaveLength(75);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('early-exits when targetSequence found on first page', async () => {
      const page1Works = Array.from({ length: 50 }, (_, i) => ({ id: `work-${i}`, series_id: 1, sequence_numeric: i + 1 }));

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ status: 200, data: page1Works, pagination: { count: 150, page: 1, limit: 50, next: 'page=2', previous: null } }),
      } as Response);

      const result = await client.fetchWorks('col-1', undefined, 5);
      expect(result).toHaveLength(50);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('early-exits when targetSequence found on subsequent page', async () => {
      const page1Works = Array.from({ length: 50 }, (_, i) => ({ id: `work-${i}`, series_id: 1, sequence_numeric: i + 1 }));
      const page2Works = Array.from({ length: 50 }, (_, i) => ({ id: `work-${50 + i}`, series_id: 1, sequence_numeric: 51 + i }));

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({ status: 200, data: page1Works, pagination: { count: 150, page: 1, limit: 50, next: 'page=2', previous: null } }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({ status: 200, data: page2Works, pagination: { count: 150, page: 2, limit: 50, next: 'page=3', previous: 'page=1' } }),
        } as Response);

      const result = await client.fetchWorks('col-1', undefined, 60);
      expect(result).toHaveLength(100);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('handles mid-pagination failure and logs warning', async () => {
      const page1Works = Array.from({ length: 50 }, (_, i) => ({ id: `work-${i}`, series_id: 1, sequence_numeric: i }));

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({ status: 200, data: page1Works, pagination: { count: 100, page: 1, limit: 50, next: 'page=2', previous: null } }),
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
        } as Response);

      const result = await client.fetchWorks('col-1');
      expect(result).toHaveLength(50);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('returns empty array when response is not ok', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      const result = await client.fetchWorks('col-1');
      expect(result).toEqual([]);
    });

    it('returns empty array when fetch throws a generic error', async () => {
      mockFetch.mockRejectedValue(new Error('timeout'));

      const result = await client.fetchWorks('col-1');
      expect(result).toEqual([]);
    });

    it('rethrows ProviderThrottleError', async () => {
      mockFetch.mockRejectedValue(new ProviderThrottleError(1000));

      await expect(client.fetchWorks('col-1')).rejects.toThrow(ProviderThrottleError);
    });

    it('returns partial results when signal aborted mid-pagination', async () => {
      const page1Works = Array.from({ length: 50 }, (_, i) => ({ id: `work-${i}`, series_id: 1, sequence_numeric: i }));

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ status: 200, data: page1Works, pagination: { count: 200, page: 1, limit: 50, next: 'page=2', previous: null } }),
      } as Response);

      const controller = new AbortController();
      // Abort before second page fetch
      controller.abort();

      const result = await client.fetchWorks('col-1', controller.signal);
      expect(result).toHaveLength(50);
    });

    it('caps pagination at 50 pages when API reports more', async () => {
      const page1Works = Array.from({ length: 50 }, (_, i) => ({ id: `work-${i}`, series_id: 1, sequence_numeric: i }));

      // API reports 10000 works = 200 pages, but we cap at 50
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ status: 200, data: page1Works, pagination: { count: 10000, page: 1, limit: 50, next: 'page=2', previous: null } }),
      } as Response);

      // Mock remaining 49 pages (pages 2-50)
      for (let i = 0; i < 49; i++) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({ status: 200, data: page1Works, pagination: { count: 10000, page: i + 2, limit: 50, next: null, previous: null } }),
        } as Response);
      }

      const result = await client.fetchWorks('col-1');
      // 50 pages * 50 works = 2500 works
      expect(result).toHaveLength(2500);
      expect(mockFetch).toHaveBeenCalledTimes(50);
    });
  });

  describe('fetchWork()', () => {
    it('returns work on success', async () => {
      const mockWork = { id: '019e1d69-4210-767b-acd5-1de151bd138b', series_id: 1, sequence_numeric: 1 };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 200, data: mockWork }),
      } as Response);

      const result = await client.fetchWork('019e1d69-4210-767b-acd5-1de151bd138b');
      expect(result).toEqual(mockWork);
    });

    it('calls correct URL', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 200, data: { id: 'test-uuid' } }),
      } as Response);

      await client.fetchWork('019e1d69-4210-767b-acd5-1de151bd138b');

      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/v1/works/019e1d69-4210-767b-acd5-1de151bd138b'), expect.any(Object));
    });

    it('returns null when response is not ok', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      const result = await client.fetchWork('019e1d69-4210-767b-acd5-1de151bd138b');
      expect(result).toBeNull();
    });

    it('returns null when fetch throws a generic error', async () => {
      mockFetch.mockRejectedValue(new Error('timeout'));

      const result = await client.fetchWork('019e1d69-4210-767b-acd5-1de151bd138b');
      expect(result).toBeNull();
    });

    it('rethrows ProviderThrottleError', async () => {
      mockFetch.mockRejectedValue(new ProviderThrottleError(1000));

      await expect(client.fetchWork('019e1d69-4210-767b-acd5-1de151bd138b')).rejects.toThrow(ProviderThrottleError);
    });
  });
});
