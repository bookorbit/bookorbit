import { describe, expect, it } from 'vitest'
import { DEFAULT_METADATA_CACHE_CONFIG, type MetadataCacheConfig, type MetadataCacheProviderInfo } from '@bookorbit/types'
import {
  buildCacheConfig,
  cacheHitRate,
  cacheRequestsAvoided,
  cacheSettingsSnapshot,
  durationDraftFromSeconds,
  hasCacheSettingsErrors,
  resetProviderOverride,
  toCacheSettingsDraft,
  validateCacheSettings,
} from '../cache-settings'

const DAY = 86_400
const HOUR = 3_600

const PROVIDERS: MetadataCacheProviderInfo[] = [
  { namespace: 'book', provider: 'google', label: 'Google Books', cacheable: true, cachesEmptyResults: true },
  { namespace: 'book', provider: 'amazon', label: 'Amazon', cacheable: true, cachesEmptyResults: false },
  { namespace: 'book', provider: 'hardcover', label: 'Hardcover', cacheable: false, cachesEmptyResults: false },
  { namespace: 'author', provider: 'goodreads', label: 'Goodreads', cacheable: true, cachesEmptyResults: true },
]

function config(overrides: Partial<MetadataCacheConfig> = {}): MetadataCacheConfig {
  return { ...DEFAULT_METADATA_CACHE_CONFIG, ...overrides }
}

describe('durations', () => {
  it('reads whole days as days and anything else as hours', () => {
    expect(durationDraftFromSeconds(30 * DAY)).toEqual({ amount: 30, unit: 'days' })
    expect(durationDraftFromSeconds(36 * HOUR)).toEqual({ amount: 36, unit: 'hours' })
    expect(durationDraftFromSeconds(0)).toEqual({ amount: 0, unit: 'days' })
    expect(durationDraftFromSeconds(5_400)).toEqual({ amount: 1.5, unit: 'hours' })
  })
})

describe('cache settings draft', () => {
  it('round-trips the saved config into the same request body', () => {
    const saved = config({
      providerOverrides: [
        { namespace: 'book', provider: 'google', resultsTtlSeconds: 7 * DAY, emptyTtlSeconds: 12 * HOUR },
        { namespace: 'author', provider: 'goodreads', enabled: false },
      ],
    })
    const draft = toCacheSettingsDraft(saved, PROVIDERS)

    expect(buildCacheConfig(draft, PROVIDERS)).toEqual(saved)
  })

  it('drops an override for a provider the server no longer lists', () => {
    const draft = toCacheSettingsDraft(config({ providerOverrides: [{ namespace: 'book', provider: 'retired', enabled: false }] }), PROVIDERS)

    expect(buildCacheConfig(draft, PROVIDERS)?.providerOverrides).toEqual([])
  })

  it('treats an equivalent duration in another unit as unchanged', () => {
    const draft = toCacheSettingsDraft(config(), PROVIDERS)
    const before = cacheSettingsSnapshot(draft, PROVIDERS)

    const edited = { ...draft, resultsTtl: { amount: 7 * 24, unit: 'hours' as const } }
    expect(cacheSettingsSnapshot(edited, PROVIDERS)).toBe(before)
    expect(cacheSettingsSnapshot({ ...draft, resultsTtl: { amount: 6, unit: 'days' as const } }, PROVIDERS)).not.toBe(before)
  })

  it('writes enabled false only for a provider switched off, and clears it on reset', () => {
    const draft = toCacheSettingsDraft(config(), PROVIDERS)
    const google = draft.overrides['book:google']!
    const off = { ...draft, overrides: { ...draft.overrides, 'book:google': { ...google, enabled: false } } }

    expect(buildCacheConfig(off, PROVIDERS)?.providerOverrides).toEqual([{ namespace: 'book', provider: 'google', enabled: false }])

    const reset = resetProviderOverride(off.overrides['book:google']!, { resultsUnit: 'days', emptyUnit: 'days' })
    expect(buildCacheConfig({ ...off, overrides: { ...off.overrides, 'book:google': reset } }, PROVIDERS)?.providerOverrides).toEqual([])
  })
})

describe('cache settings validation', () => {
  it('accepts the defaults', () => {
    const errors = validateCacheSettings(toCacheSettingsDraft(config(), PROVIDERS), PROVIDERS)
    expect(hasCacheSettingsErrors(errors)).toBe(false)
  })

  it('allows zero for empty answers and stale grace but not for results', () => {
    const draft = toCacheSettingsDraft(config(), PROVIDERS)
    const zeroed = {
      ...draft,
      resultsTtl: { amount: 0, unit: 'days' as const },
      emptyTtl: { amount: 0, unit: 'days' as const },
      staleGrace: { amount: 0, unit: 'days' as const },
    }
    const errors = validateCacheSettings(zeroed, PROVIDERS)

    expect(errors.resultsTtl).toEqual({ kind: 'range', min: HOUR, max: 365 * DAY })
    expect(errors.emptyTtl).toBeUndefined()
    expect(errors.staleGrace).toBeUndefined()
    expect(buildCacheConfig(zeroed, PROVIDERS)).toBeNull()
  })

  it('rejects blank globals, out-of-range values and a fractional storage budget', () => {
    const draft = toCacheSettingsDraft(config(), PROVIDERS)
    const errors = validateCacheSettings(
      {
        ...draft,
        resultsTtl: { amount: null, unit: 'days' },
        emptyTtl: { amount: 31, unit: 'days' },
        staleGrace: { amount: -1, unit: 'days' },
        maxStorageMb: 100.5,
      },
      PROVIDERS,
    )

    expect(errors.resultsTtl).toEqual({ kind: 'required' })
    expect(errors.emptyTtl).toEqual({ kind: 'range', min: 0, max: 30 * DAY })
    expect(errors.staleGrace?.kind).toBe('range')
    expect(errors.maxStorageMb).toEqual({ kind: 'integer' })
    expect(validateCacheSettings({ ...draft, maxStorageMb: 20 }, PROVIDERS).maxStorageMb).toEqual({ kind: 'range', min: 50, max: 10240 })
  })

  it('validates provider overrides, skipping the empty TTL where empty answers are never cached', () => {
    const draft = toCacheSettingsDraft(config(), PROVIDERS)
    const errors = validateCacheSettings(
      {
        ...draft,
        overrides: {
          ...draft.overrides,
          'book:google': { ...draft.overrides['book:google']!, resultsTtl: { amount: 30, unit: 'hours' }, emptyTtl: { amount: 40, unit: 'days' } },
          'book:amazon': { ...draft.overrides['book:amazon']!, emptyTtl: { amount: 40, unit: 'days' } },
        },
      },
      PROVIDERS,
    )

    expect(errors.overrides['book:google']).toEqual({ emptyTtl: { kind: 'range', min: 0, max: 30 * DAY } })
    expect(errors.overrides['book:amazon']).toBeUndefined()
  })
})

describe('cache stats helpers', () => {
  it('computes the hit rate only once something has been looked up', () => {
    expect(cacheHitRate({ hits: 0, misses: 0 })).toBeNull()
    expect(cacheHitRate({ hits: 3, misses: 1 })).toBe(0.75)
  })

  it('counts fallbacks as requests avoided', () => {
    expect(cacheRequestsAvoided({ hits: 10, fallbacks: 2 })).toBe(12)
  })
})
