import { describe, expect, it } from 'vitest'
import type { MetadataFetchDiagnostics } from '@bookorbit/types'
import {
  diagnosticsFallbackProviders,
  ignoreCachePostInit,
  splitCandidateCache,
  splitMetadataCacheUsage,
  summarizeCandidateCache,
  usageFallbackProviders,
  withIgnoreCache,
} from '../metadata-cache'

describe('summarizeCandidateCache', () => {
  it('counts cached and stale answers and finds the oldest', () => {
    expect(
      summarizeCandidateCache([
        { fetchedAt: '2026-10-05T00:00:00.000Z', stale: false },
        null,
        { fetchedAt: '2026-09-01T00:00:00.000Z', stale: true },
        undefined,
        { fetchedAt: '2026-10-09T00:00:00.000Z', stale: false },
      ]),
    ).toEqual({ cachedCount: 3, staleCount: 1, oldestFetchedAt: '2026-09-01T00:00:00.000Z' })
  })

  it('ignores an unreadable date when picking the oldest answer', () => {
    expect(summarizeCandidateCache([{ fetchedAt: 'not a date', stale: false }])).toEqual({ cachedCount: 1, staleCount: 0, oldestFetchedAt: null })
  })

  it('reports nothing for live results', () => {
    expect(summarizeCandidateCache([null, undefined])).toEqual({ cachedCount: 0, staleCount: 0, oldestFetchedAt: null })
  })
})

describe('splitCandidateCache', () => {
  it('takes the marker off the candidate', () => {
    const { candidate, cache } = splitCandidateCache({
      provider: 'google',
      providerId: 'g1',
      cache: { fetchedAt: '2026-10-01T00:00:00.000Z', stale: true },
    })
    expect(candidate).toEqual({ provider: 'google', providerId: 'g1' })
    expect(cache).toEqual({ fetchedAt: '2026-10-01T00:00:00.000Z', stale: true })
  })

  it('treats a missing or malformed marker as a live answer', () => {
    expect(splitCandidateCache({ provider: 'google' }).cache).toBeNull()
    expect(splitCandidateCache({ provider: 'google', cache: 'yesterday' } as never).cache).toBeNull()
  })
})

describe('refresh responses', () => {
  it('splits the cache report from the record', () => {
    const usage = { fallbackProviders: [{ provider: 'google', source: 'fallback' as const, stale: true, cachedAt: '2026-10-01T00:00:00.000Z' }] }
    expect(splitMetadataCacheUsage({ id: 1, metadataCache: usage })).toEqual({ value: { id: 1 }, usage })
    expect(splitMetadataCacheUsage({ id: 1 })).toEqual({ value: { id: 1 }, usage: null })
  })

  it('keeps only fallback providers', () => {
    const served = [
      { provider: 'google', source: 'cache' as const, stale: false, cachedAt: '2026-10-01T00:00:00.000Z' },
      { provider: 'amazon', source: 'fallback' as const, stale: true, cachedAt: '2026-09-01T00:00:00.000Z' },
    ]
    expect(usageFallbackProviders({ fallbackProviders: served }).map((entry) => entry.provider)).toEqual(['amazon'])
    expect(diagnosticsFallbackProviders({ cacheServedProviders: served } as MetadataFetchDiagnostics).map((entry) => entry.provider)).toEqual([
      'amazon',
    ])
    expect(diagnosticsFallbackProviders({} as MetadataFetchDiagnostics)).toEqual([])
    expect(usageFallbackProviders(null)).toEqual([])
  })
})

describe('ignore cache requests', () => {
  it('leaves a trigger POST bodiless unless the cache is ignored', () => {
    expect(ignoreCachePostInit()).toEqual({ method: 'POST' })
    expect(ignoreCachePostInit({ ignoreCache: false })).toEqual({ method: 'POST' })
    expect(ignoreCachePostInit({ ignoreCache: true })).toEqual({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ignoreCache: true }),
    })
  })

  it('adds ignoreCache to a body only when it is true', () => {
    expect(withIgnoreCache({ bookIds: [1] })).toEqual({ bookIds: [1] })
    expect(withIgnoreCache({ bookIds: [1] }, { ignoreCache: false })).toEqual({ bookIds: [1] })
    expect(withIgnoreCache({ bookIds: [1] }, { ignoreCache: true })).toEqual({ bookIds: [1], ignoreCache: true })
  })
})
