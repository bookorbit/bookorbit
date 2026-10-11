import type {
  MetadataCacheRequestPolicy,
  MetadataCacheServedProvider,
  MetadataCacheUsage,
  MetadataCandidateCacheInfo,
  MetadataFetchDiagnostics,
} from '@bookorbit/types'

/** Asks the server to skip saved answers and call every provider live. */
export const METADATA_CACHE_REFRESH: MetadataCacheRequestPolicy = 'refresh'

/** What a set of search results owes to the metadata cache. */
export interface MetadataCacheSummary {
  cachedCount: number
  staleCount: number
  oldestFetchedAt: string | null
}

export const EMPTY_METADATA_CACHE_SUMMARY: MetadataCacheSummary = { cachedCount: 0, staleCount: 0, oldestFetchedAt: null }

/** A refresh response that may say which providers answered from saved results. */
export type WithMetadataCacheUsage<T> = T & { metadataCache?: MetadataCacheUsage }

export interface IgnoreCacheOptions {
  ignoreCache?: boolean
}

export function summarizeCandidateCache(infos: Iterable<MetadataCandidateCacheInfo | null | undefined>): MetadataCacheSummary {
  let cachedCount = 0
  let staleCount = 0
  let oldestTime = Number.POSITIVE_INFINITY
  let oldestFetchedAt: string | null = null
  for (const info of infos) {
    if (!info) continue
    cachedCount += 1
    if (info.stale) staleCount += 1
    const time = Date.parse(info.fetchedAt)
    if (Number.isFinite(time) && time < oldestTime) {
      oldestTime = time
      oldestFetchedAt = info.fetchedAt
    }
  }
  return { cachedCount, staleCount, oldestFetchedAt }
}

/**
 * Separates the cache marker from a streamed candidate. The marker describes the answer, not the
 * record, so it must not travel with the candidate into forms or requests the server validates.
 */
export function splitCandidateCache<T extends object>(
  event: T & { cache?: MetadataCandidateCacheInfo },
): { candidate: T; cache: MetadataCandidateCacheInfo | null } {
  const { cache, ...candidate } = event
  return { candidate: candidate as T, cache: isCandidateCacheInfo(cache) ? cache : null }
}

function isCandidateCacheInfo(value: unknown): value is MetadataCandidateCacheInfo {
  if (!value || typeof value !== 'object') return false
  return typeof (value as Partial<MetadataCandidateCacheInfo>).fetchedAt === 'string'
}

/** Strips the cache report from a refresh response, returning the record and the report apart. */
export function splitMetadataCacheUsage<T extends object>(value: WithMetadataCacheUsage<T>): { value: T; usage: MetadataCacheUsage | null } {
  const { metadataCache, ...rest } = value
  return { value: rest as T, usage: metadataCache ?? null }
}

export function fallbackProviders(served: readonly MetadataCacheServedProvider[] | null | undefined): MetadataCacheServedProvider[] {
  return (served ?? []).filter((entry) => entry.source === 'fallback')
}

export function usageFallbackProviders(usage: MetadataCacheUsage | null | undefined): MetadataCacheServedProvider[] {
  return fallbackProviders(usage?.fallbackProviders)
}

export function diagnosticsFallbackProviders(diagnostics: MetadataFetchDiagnostics | null | undefined): MetadataCacheServedProvider[] {
  return fallbackProviders(diagnostics?.cacheServedProviders)
}

/** A POST that takes an optional `{ ignoreCache }` body. Without the flag it is sent exactly as before the cache existed. */
export function ignoreCachePostInit(options: IgnoreCacheOptions = {}): RequestInit {
  if (options.ignoreCache !== true) return { method: 'POST' }
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ignoreCache: true }),
  }
}

/** Adds `ignoreCache: true` to a request body only when it was asked for, so older servers keep accepting the default. */
export function withIgnoreCache<T extends object>(body: T, options: IgnoreCacheOptions = {}): T | (T & { ignoreCache: true }) {
  return options.ignoreCache === true ? { ...body, ignoreCache: true } : body
}
