import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as fetchWithThrottleModule from '../../fetch-with-throttle';
import { ProviderThrottleError } from '../../provider-throttle.error';
import { RanobeDbClient } from './ranobedb.client';

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

describe('RanobeDbClient', () => {
  let client: RanobeDbClient;
  let mockFetch: ReturnType<typeof vi.mocked<typeof fetchWithThrottleModule.fetchWithThrottle>>;

  beforeEach(() => {
    client = new RanobeDbClient();
    mockFetch = vi.mocked(fetchWithThrottleModule.fetchWithThrottle);
    vi.clearAllMocks();
  });

  describe('search()', () => {
    it('returns array of book IDs on success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ books: [{ id: 1 }, { id: 2 }, { id: 3 }], count: 3, currentPage: 1, totalPages: 1 }),
      } as Response);

      const result = await client.search('Sword Art Online');
      expect(result).toEqual([1, 2, 3]);
    });

    it('builds query parameters correctly', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ books: [], count: 0, currentPage: 1, totalPages: 0 }),
      } as Response);

      await client.search('Re:Zero');

      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('q=Re%3AZero'), expect.any(Object));
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('limit=5'), expect.any(Object));
    });

    it('sends correct User-Agent header', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ books: [], count: 0, currentPage: 1, totalPages: 0 }),
      } as Response);

      await client.search('test');

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

      const result = await client.search('query');
      expect(result).toEqual([]);
    });

    it('returns empty array when fetch throws a generic error', async () => {
      mockFetch.mockRejectedValue(new Error('network failure'));

      const result = await client.search('query');
      expect(result).toEqual([]);
    });

    it('rethrows ProviderThrottleError', async () => {
      mockFetch.mockRejectedValue(new ProviderThrottleError('ranobedb', 1000));

      await expect(client.search('query')).rejects.toThrow(ProviderThrottleError);
    });

    it('returns empty array when books field is missing from response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      } as Response);

      const result = await client.search('query');
      expect(result).toEqual([]);
    });
  });

  describe('fetchBook()', () => {
    it('returns book response on success', async () => {
      const mockBook = {
        id: 42,
        title: 'Test Book',
        romaji: null,
        lang: 'ja',
        c_release_date: 20220101,
        image: null,
        rating: null,
        titles: [],
        editions: [],
        releases: [],
        publishers: [],
        series: null,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ book: mockBook }),
      } as Response);

      const result = await client.fetchBook(42);
      expect(result).toEqual({ book: mockBook });
    });

    it('calls correct URL', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ book: { id: 42 } }),
      } as Response);

      await client.fetchBook(42);

      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/book/42'), expect.any(Object));
    });

    it('returns null when response is not ok', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      const result = await client.fetchBook(999);
      expect(result).toBeNull();
    });

    it('returns null when fetch throws a generic error', async () => {
      mockFetch.mockRejectedValue(new Error('timeout'));

      const result = await client.fetchBook(1);
      expect(result).toBeNull();
    });

    it('rethrows ProviderThrottleError', async () => {
      mockFetch.mockRejectedValue(new ProviderThrottleError('ranobedb', 1000));

      await expect(client.fetchBook(1)).rejects.toThrow(ProviderThrottleError);
    });
  });
});
