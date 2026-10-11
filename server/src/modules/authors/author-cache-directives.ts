import type { MetadataCacheRequestPolicy } from '@bookorbit/types';

import type { CacheDirective } from '../../common/provider-cache/provider-cache-spec';

/** What remains of the pause between items when an item never left the server. */
export const CACHE_ONLY_ITEM_YIELD_MS = 100;

/** Interactive search, stream and lookup: cached answers unless the client asks to go live. */
export function interactiveCacheDirective(policy?: MetadataCacheRequestPolicy): CacheDirective {
  return { policy: policy ?? 'default', allowFallback: true };
}

/** An explicit single-author refresh is always live, falling back to a saved answer for a provider that fails. */
export const SINGLE_REFRESH_CACHE_DIRECTIVE: CacheDirective = { policy: 'refresh', allowFallback: true };

export function bulkRefreshCacheDirective(ignoreCache: boolean): CacheDirective {
  return { policy: ignoreCache ? 'refresh' : 'default', allowFallback: true };
}

/**
 * Background enrichment requeues transient failures with backoff, so a saved answer only stands in
 * for a failing provider on the last attempt; earlier attempts fail and retry as they always have.
 */
export function backgroundEnrichmentCacheDirective(ignoreCache: boolean, finalAttempt: boolean): CacheDirective {
  return { policy: ignoreCache ? 'refresh' : 'default', allowFallback: finalAttempt };
}
