import type { CoverSearchResult } from '@projectx/types';

import { CoverProviderRegistry } from './provider-registry';
import { CoverService } from './cover.service';

function makeResult(url: string, previewUrl: string): CoverSearchResult {
  return {
    url,
    sourceUrl: url,
    previewUrl,
    width: 600,
    height: 600,
    source: 'Test',
  };
}

describe('CoverService.searchCovers', () => {
  it('selects providers, deduplicates by source/url, and proxies preview URLs', async () => {
    const providerA = {
      key: 'duckduckgo' as const,
      search: vi
        .fn()
        .mockResolvedValue([
          makeResult('https://img.example/a.jpg', 'https://thumb.example/a.jpg'),
          makeResult('https://img.example/b.jpg', 'https://thumb.example/b.jpg'),
        ]),
    };
    const providerB = {
      key: 'itunes' as const,
      search: vi
        .fn()
        .mockResolvedValue([
          makeResult('https://img.example/b.jpg', 'https://thumb.example/b.jpg'),
          makeResult('https://img.example/c.jpg', 'https://thumb.example/c.jpg'),
        ]),
    };
    const providerRegistry = {
      select: vi.fn().mockReturnValue([providerA, providerB]),
    } as unknown as CoverProviderRegistry;

    const service = new CoverService(
      {} as never,
      {} as never,
      {} as never,
      { get: vi.fn().mockReturnValue('/tmp/books') } as never,
      providerRegistry,
    );

    const results = await service.searchCovers({ title: 'Dune', author: 'Frank Herbert', provider: 'all' });

    expect((providerRegistry.select as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]).toBe('all');
    expect(providerA.search).toHaveBeenCalledWith({ title: 'Dune', author: 'Frank Herbert' });
    expect(providerB.search).toHaveBeenCalledWith({ title: 'Dune', author: 'Frank Herbert' });
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.sourceUrl)).toEqual(['https://img.example/a.jpg', 'https://img.example/b.jpg', 'https://img.example/c.jpg']);
    expect(results[0].previewUrl).toBe('/api/v1/books/cover/proxy?url=https%3A%2F%2Fthumb.example%2Fa.jpg');
  });

  it('interleaves first five iTunes covers with duckduckgo when provider is all', async () => {
    const providerA = {
      key: 'duckduckgo' as const,
      search: vi
        .fn()
        .mockResolvedValue([
          makeResult('https://img.example/ddg-1.jpg', 'https://thumb.example/ddg-1.jpg'),
          makeResult('https://img.example/ddg-2.jpg', 'https://thumb.example/ddg-2.jpg'),
          makeResult('https://img.example/ddg-3.jpg', 'https://thumb.example/ddg-3.jpg'),
          makeResult('https://img.example/ddg-4.jpg', 'https://thumb.example/ddg-4.jpg'),
        ]),
    };
    const providerB = {
      key: 'itunes' as const,
      search: vi
        .fn()
        .mockResolvedValue([
          makeResult('https://img.example/it-1.jpg', 'https://thumb.example/it-1.jpg'),
          makeResult('https://img.example/it-2.jpg', 'https://thumb.example/it-2.jpg'),
          makeResult('https://img.example/it-3.jpg', 'https://thumb.example/it-3.jpg'),
          makeResult('https://img.example/it-4.jpg', 'https://thumb.example/it-4.jpg'),
          makeResult('https://img.example/it-5.jpg', 'https://thumb.example/it-5.jpg'),
          makeResult('https://img.example/it-6.jpg', 'https://thumb.example/it-6.jpg'),
        ]),
    };
    const providerRegistry = {
      select: vi.fn().mockReturnValue([providerA, providerB]),
    } as unknown as CoverProviderRegistry;

    const service = new CoverService(
      {} as never,
      {} as never,
      {} as never,
      { get: vi.fn().mockReturnValue('/tmp/books') } as never,
      providerRegistry,
    );

    const results = await service.searchCovers({ title: 'Dune', provider: 'all' });
    expect(results.map((r) => r.sourceUrl)).toEqual([
      'https://img.example/ddg-1.jpg',
      'https://img.example/it-1.jpg',
      'https://img.example/ddg-2.jpg',
      'https://img.example/it-2.jpg',
      'https://img.example/ddg-3.jpg',
      'https://img.example/it-3.jpg',
      'https://img.example/ddg-4.jpg',
      'https://img.example/it-4.jpg',
      'https://img.example/it-5.jpg',
      'https://img.example/it-6.jpg',
    ]);
  });
});
