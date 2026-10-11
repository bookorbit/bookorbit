import {
  backgroundEnrichmentCacheDirective,
  bulkRefreshCacheDirective,
  CACHE_ONLY_ITEM_YIELD_MS,
  interactiveCacheDirective,
  SINGLE_REFRESH_CACHE_DIRECTIVE,
} from './author-cache-directives';

describe('author cache directives', () => {
  it('lets interactive requests choose between cached and live answers, always with fallback', () => {
    expect(interactiveCacheDirective()).toEqual({ policy: 'default', allowFallback: true });
    expect(interactiveCacheDirective('default')).toEqual({ policy: 'default', allowFallback: true });
    expect(interactiveCacheDirective('refresh')).toEqual({ policy: 'refresh', allowFallback: true });
  });

  it('always refreshes a single author live with fallback', () => {
    expect(SINGLE_REFRESH_CACHE_DIRECTIVE).toEqual({ policy: 'refresh', allowFallback: true });
  });

  it('uses the cache for bulk refresh unless told to ignore it, always with fallback', () => {
    expect(bulkRefreshCacheDirective(false)).toEqual({ policy: 'default', allowFallback: true });
    expect(bulkRefreshCacheDirective(true)).toEqual({ policy: 'refresh', allowFallback: true });
  });

  it('only falls back on the final background attempt', () => {
    expect(backgroundEnrichmentCacheDirective(false, false)).toEqual({ policy: 'default', allowFallback: false });
    expect(backgroundEnrichmentCacheDirective(false, true)).toEqual({ policy: 'default', allowFallback: true });
    expect(backgroundEnrichmentCacheDirective(true, false)).toEqual({ policy: 'refresh', allowFallback: false });
    expect(backgroundEnrichmentCacheDirective(true, true)).toEqual({ policy: 'refresh', allowFallback: true });
  });

  it('yields briefly between cache-only items', () => {
    expect(CACHE_ONLY_ITEM_YIELD_MS).toBe(100);
  });
});
