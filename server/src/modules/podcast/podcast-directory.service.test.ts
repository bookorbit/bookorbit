import { BadGatewayException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PodcastDirectoryService } from './podcast-directory.service';

function createService(): PodcastDirectoryService {
  return new PodcastDirectoryService({ requestTimeoutMs: 30_000 } as never);
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body), body: null } as unknown as Response;
}

describe('PodcastDirectoryService', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('queries the fixed directory host and maps rows to the shared result shape', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        results: [
          {
            collectionName: '  Orbit Weekly  ',
            artistName: 'Orbit Media',
            feedUrl: 'https://feeds.example.com/orbit.xml',
            artworkUrl600: 'https://art.example.com/600.jpg',
            artworkUrl100: 'https://art.example.com/100.jpg',
            primaryGenreName: 'Technology',
          },
        ],
      }),
    );

    const results = await createService().search('  Orbit   Weekly ', 10);

    expect(results).toEqual([
      {
        title: 'Orbit Weekly',
        author: 'Orbit Media',
        feedUrl: 'https://feeds.example.com/orbit.xml',
        artworkUrl: 'https://art.example.com/600.jpg',
        genre: 'Technology',
      },
    ]);
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe('https://itunes.apple.com/search');
    expect(url.searchParams.get('media')).toBe('podcast');
    expect(url.searchParams.get('term')).toBe('orbit weekly');
    expect(url.searchParams.get('limit')).toBe('50');
  });

  it('drops rows without a usable feed and de-duplicates repeated feeds', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        results: [
          { collectionName: 'No feed', artistName: 'A' },
          { collectionName: 'Bad scheme', feedUrl: 'ftp://feeds.example.com/a.xml' },
          { collectionName: '   ', feedUrl: 'https://feeds.example.com/b.xml' },
          { collectionName: 'First', feedUrl: 'https://feeds.example.com/c.xml' },
          { collectionName: 'Duplicate', feedUrl: 'https://feeds.example.com/c.xml' },
        ],
      }),
    );

    const results = await createService().search('orbit', 10);

    expect(results.map((result) => result.title)).toEqual(['First']);
    expect(results[0]?.artworkUrl).toBeNull();
    expect(results[0]?.author).toBeNull();
  });

  it('caches a term for ten minutes and slices the cached list to the requested limit', async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValue(
        jsonResponse({
          results: Array.from({ length: 5 }, (_, index) => ({
            collectionName: `Show ${index}`,
            feedUrl: `https://feeds.example.com/${index}.xml`,
          })),
        }),
      );
      const service = createService();

      expect(await service.search('orbit', 2)).toHaveLength(2);
      expect(await service.search('ORBIT', 5)).toHaveLength(5);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(10 * 60_000 + 1);
      expect(await service.search('orbit', 5)).toHaveLength(5);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports an upstream failure as a typed 502 so clients can fall back to pasting a URL', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, body: null } as unknown as Response);

    await expect(createService().search('orbit', 10)).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('reports a network failure as a 502 rather than leaking the transport error', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));

    await expect(createService().search('orbit', 10)).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('returns nothing for a blank term without calling upstream', async () => {
    expect(await createService().search('   ', 10)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
