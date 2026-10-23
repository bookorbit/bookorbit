import { canonicalJson, canonicalRegion } from '../../../../common/provider-cache/canonicalize';
import type { ProviderCacheContext } from '../../../../common/provider-cache/provider-cache-spec';

export const DEFAULT_AUTHOR_REGION = 'us';

export function authorProviderCacheContext(available: boolean, fingerprint: Record<string, unknown> = {}): ProviderCacheContext {
  return { available, fingerprint: canonicalJson(fingerprint) };
}

/** Region changes what a provider answers, so the key and the request must use the same canonical form. */
export function canonicalAuthorRegion(region: unknown): string {
  return canonicalRegion(region, DEFAULT_AUTHOR_REGION);
}
