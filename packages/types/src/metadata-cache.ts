/** Which provider subsystem a cache entry belongs to. Book and author registries share some keys. */
export const METADATA_CACHE_NAMESPACES = ["book", "author"] as const;
export type MetadataCacheNamespace = (typeof METADATA_CACHE_NAMESPACES)[number];

/** The cache policies a client may request. Every other policy is chosen by the server. */
export const METADATA_CACHE_REQUEST_POLICIES = ["default", "refresh"] as const;
export type MetadataCacheRequestPolicy = (typeof METADATA_CACHE_REQUEST_POLICIES)[number];

export const METADATA_CACHE_STATUSES = ["results", "empty", "found", "not_found"] as const;
export type MetadataCacheEntryStatus = (typeof METADATA_CACHE_STATUSES)[number];

export interface MetadataCacheProviderOverride {
  namespace: MetadataCacheNamespace;
  provider: string;
  /** False turns caching off for this provider only. Absent inherits the global switch. */
  enabled?: boolean;
  resultsTtlSeconds?: number;
  emptyTtlSeconds?: number;
}

export interface MetadataCacheConfig {
  enabled: boolean;
  resultsTtlSeconds: number;
  /** Zero never caches empty answers. Only applies to providers that report failures reliably. */
  emptyTtlSeconds: number;
  /** How long past its TTL an entry may still answer for a provider that failed. Zero disables. */
  staleGraceSeconds: number;
  maxStorageMb: number;
  providerOverrides: MetadataCacheProviderOverride[];
}

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

export const METADATA_CACHE_LIMITS = {
  resultsTtlSeconds: { min: HOUR, max: 365 * DAY },
  emptyTtlSeconds: { min: 0, max: 30 * DAY },
  staleGraceSeconds: { min: 0, max: 90 * DAY },
  maxStorageMb: { min: 50, max: 10240 },
  maxProviderOverrides: 64,
} as const;

export const DEFAULT_METADATA_CACHE_CONFIG: MetadataCacheConfig = {
  enabled: true,
  resultsTtlSeconds: 7 * DAY,
  emptyTtlSeconds: 7 * DAY,
  staleGraceSeconds: 7 * DAY,
  maxStorageMb: 512,
  providerOverrides: [],
};

/** A provider as the cache settings see it: whether it caches at all and whether empty answers are kept. */
export interface MetadataCacheProviderInfo {
  namespace: MetadataCacheNamespace;
  provider: string;
  label: string;
  cacheable: boolean;
  cachesEmptyResults: boolean;
}

export interface MetadataCacheConfigResponse {
  config: MetadataCacheConfig;
  providers: MetadataCacheProviderInfo[];
}

export interface MetadataCacheProviderStats {
  namespace: MetadataCacheNamespace;
  provider: string;
  entries: number;
  emptyEntries: number;
  payloadBytes: number;
}

export interface MetadataCacheCounters {
  hits: number;
  misses: number;
  fallbacks: number;
  liveCalls: number;
  writes: number;
  skippedWrites: number;
  writeFailures: number;
  readFailures: number;
  uncacheable: Record<string, number>;
}

export interface MetadataCacheStats {
  entries: number;
  payloadBytes: number;
  relationBytes: number;
  maxStorageBytes: number;
  oldestFetchedAt: string | null;
  providers: MetadataCacheProviderStats[];
  /** Since the server started. */
  counters: MetadataCacheCounters;
  sweepRunning: boolean;
  lastSweepAt: string | null;
}

export interface MetadataCacheClearRequest {
  namespace?: MetadataCacheNamespace;
  provider?: string;
  /** Only empty answers (`empty` and `not_found`). */
  emptyOnly?: boolean;
}

export interface MetadataCacheClearResponse {
  /** Rows removed now. A partial clear may keep removing rows in the background. */
  deleted: number;
  pending: boolean;
}

/** Where a candidate came from when the cache answered for its provider. */
export interface MetadataCandidateCacheInfo {
  fetchedAt: string;
  /** True when the entry is past its TTL and answered only because the provider failed. */
  stale: boolean;
}

/** A provider the cache answered for during a fetch, instead of or after a live call. */
export interface MetadataCacheServedProvider {
  provider: string;
  source: "cache" | "fallback";
  stale: boolean;
  cachedAt: string;
}

/** Added to single-item refresh responses so a client can say which providers were not live. */
export interface MetadataCacheUsage {
  fallbackProviders: MetadataCacheServedProvider[];
}
