import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as fetchWithThrottleModule from '../../fetch-with-throttle';
import { HardcoverClient } from './hardcover.client';

vi.mock('../../fetch-with-throttle', () => ({
  fetchWithThrottle: vi.fn(),
}));

describe('HardcoverClient', () => {
  let client: HardcoverClient;
  const apiKey = 'test-api-key';

  beforeEach(() => {
    client = new HardcoverClient();
    vi.clearAllMocks();
  });

  it('sends a Bearer Authorization header', async () => {
    const mockFetch = vi.mocked(fetchWithThrottleModule.fetchWithThrottle);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { books: [] } }),
    } as Response);

    await client.searchByIsbn('1234567890', apiKey);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${apiKey}`,
        }),
      }),
    );
  });

  it('does not duplicate Bearer prefix when already provided', async () => {
    const mockFetch = vi.mocked(fetchWithThrottleModule.fetchWithThrottle);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { books: [] } }),
    } as Response);

    await client.searchByIsbn('1234567890', 'Bearer test-api-key');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-api-key',
        }),
      }),
    );
  });

  it('accepts quoted bearer token input', async () => {
    const mockFetch = vi.mocked(fetchWithThrottleModule.fetchWithThrottle);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { books: [] } }),
    } as Response);

    await client.searchByIsbn('1234567890', '"Bearer test-api-key"');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-api-key',
        }),
      }),
    );
  });

  it.each([
    ['ISBN search', () => client.searchByIsbn('9780756404079', apiKey)],
    ['stored ID lookup', () => client.lookupBySlug('the-name-of-the-wind', apiKey)],
  ])('requests cached tags for %s', async (_label, request) => {
    const mockFetch = vi.mocked(fetchWithThrottleModule.fetchWithThrottle);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { books: [] } }),
    } as Response);

    await request();

    const options = mockFetch.mock.calls[0][1];
    expect(typeof options?.body).toBe('string');
    if (typeof options?.body !== 'string') throw new TypeError('Expected a JSON request body');
    const body = JSON.parse(options.body) as { query: string };
    expect(body.query).toMatch(/\bcached_tags\b/);
  });

  it.each([
    ['ISBN search', () => client.searchByIsbn('9780756404079', apiKey)],
    ['stored ID lookup', () => client.lookupBySlug('the-name-of-the-wind', apiKey)],
  ])('asks for the last released main book instead of every series entry for %s', async (_label, request) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-19T23:30:00Z'));
    try {
      const mockFetch = vi.mocked(fetchWithThrottleModule.fetchWithThrottle);
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: { books: [] } }),
      } as Response);

      await request();

      const options = mockFetch.mock.calls[0][1];
      if (typeof options?.body !== 'string') throw new TypeError('Expected a JSON request body');
      const body = JSON.parse(options.body) as { query: string; variables: Record<string, unknown> };
      expect(body.query).not.toMatch(/\bbooks_count\b/);
      expect(body.query).toMatch(/\bprimary_books_count\b/);
      expect(body.query).toMatch(/release_date:\s*\{\s*_lte:\s*\$releasedBy\s*\}/);
      expect(body.query).toMatch(/canonical_id:\s*\{\s*_is_null:\s*true\s*\}/);
      expect(body.query).toMatch(/compilation:\s*\{\s*_eq:\s*false\s*\}/);
      expect(body.query).toMatch(/\$releasedBy:\s*date!/);
      expect(body.variables.releasedBy).toBe('2026-10-19');
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns empty array when API returns non-ok status', async () => {
    const mockFetch = vi.mocked(fetchWithThrottleModule.fetchWithThrottle);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    const result = await client.searchByIsbn('123', 'key');
    expect(result).toEqual([]);
  });

  it('searches author names alone, each field with its own weight and typo allowance', async () => {
    const mockFetch = vi.mocked(fetchWithThrottleModule.fetchWithThrottle);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { search: { results: { hits: [{ document: { id: 1, title: 'Mort' } }] } } } }),
    } as Response);

    const documents = await client.searchBooksByAuthor('Terry Pratchett', apiKey, undefined, 20);

    const requestBody = mockFetch.mock.calls[0][1]?.body;
    expect(typeof requestBody).toBe('string');
    if (typeof requestBody !== 'string') {
      throw new TypeError('Expected the request body to be a string');
    }
    const body = JSON.parse(requestBody) as { query: string; variables: Record<string, unknown> };
    expect(body.query).toContain('fields: "author_names", weights: "1", typos: "1"');
    expect(body.variables).toEqual({ q: 'Terry Pratchett', limit: 20 });
    expect(documents).toEqual([{ id: 1, title: 'Mort' }]);
  });

  it('returns empty array when fetch fails', async () => {
    const mockFetch = vi.mocked(fetchWithThrottleModule.fetchWithThrottle);
    mockFetch.mockRejectedValue(new Error('Network error'));

    const result = await client.searchBooks('query', 'key');
    expect(result).toEqual([]);
  });

  it('rethrows ProviderThrottleError on 429', async () => {
    const { ProviderThrottleError } = await import('../../provider-throttle.error');
    const mockFetch = vi.mocked(fetchWithThrottleModule.fetchWithThrottle);
    mockFetch.mockRejectedValue(new ProviderThrottleError('google', 100));

    await expect(client.searchByIsbn('123', 'key')).rejects.toThrow(ProviderThrottleError);
  });
});
