export type CacheOperation = 'search' | 'lookup';

/**
 * `default` reads fresh entries before going live; `refresh` always goes live; `only-if-cached`
 * never goes live; `bypass` neither reads nor writes.
 */
export type CachePolicy = 'default' | 'refresh' | 'only-if-cached' | 'bypass';

export interface CacheDirective {
  policy: CachePolicy;
  /** Serve a fresh or within-grace entry when the live call fails. */
  allowFallback: boolean;
}

export const DEFAULT_CACHE_DIRECTIVE: CacheDirective = { policy: 'default', allowFallback: true };

/**
 * What identifies one provider call for caching. `inputs` must contain every value that changes the
 * request the provider sends or how it filters the answer; anything missing can serve one request's
 * answer to another.
 */
export interface CacheKeyDescriptor {
  inputs: Record<string, unknown>;
  /**
   * Set only for providers that honour a per-request result cap. `null` means the provider's own
   * default (its largest). A stored answer serves any request asking for no more than it holds.
   */
  maxCandidates?: number | null;
  /** Set only for providers that can validate cover placeholders. */
  coverValidation?: boolean;
}

export interface ProviderCacheContext {
  /** Enabled and holding whatever credentials it needs. An unavailable provider is never answered from cache. */
  available: boolean;
  /** Result-affecting configuration, hashed by the cache before it is stored. */
  fingerprint: string;
}

export interface ProviderCacheSpec<P> {
  /** Bump when the provider's mapped output changes, so older answers stop being served. */
  readonly version: number;
  /** Only providers proven to report failures as failures may keep empty answers. */
  readonly trustEmpty: boolean;
  /** Lookup statuses that are answers rather than failures (e.g. 404 for a delisted id). */
  readonly authoritativeLookupStatuses?: readonly number[];
  context(): Promise<ProviderCacheContext>;
  describeSearch(params: P): CacheKeyDescriptor | null;
  describeLookup(providerId: string, params?: P): CacheKeyDescriptor | null;
}

export interface CacheableProvider<P> {
  readonly cache?: ProviderCacheSpec<P>;
}
