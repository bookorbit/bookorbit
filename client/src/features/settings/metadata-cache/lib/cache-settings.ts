import {
  METADATA_CACHE_LIMITS,
  type MetadataCacheConfig,
  type MetadataCacheNamespace,
  type MetadataCacheProviderInfo,
  type MetadataCacheProviderOverride,
} from '@bookorbit/types'

export const DURATION_UNITS = ['hours', 'days'] as const
export type DurationUnit = (typeof DURATION_UNITS)[number]

export const UNIT_SECONDS: Record<DurationUnit, number> = {
  hours: 60 * 60,
  days: 24 * 60 * 60,
}

/** A duration as the form holds it. A null amount means the field is blank. */
export interface DurationDraft {
  amount: number | null
  unit: DurationUnit
}

export interface ProviderOverrideDraft {
  namespace: MetadataCacheNamespace
  provider: string
  /** Off writes `enabled: false`; on leaves the provider following the global switch. */
  enabled: boolean
  /** A blank amount inherits the global value. */
  resultsTtl: DurationDraft
  emptyTtl: DurationDraft
}

export interface CacheSettingsDraft {
  enabled: boolean
  resultsTtl: DurationDraft
  emptyTtl: DurationDraft
  staleGrace: DurationDraft
  maxStorageMb: number | null
  /** One entry per provider the server lists, keyed by `providerOverrideKey`. */
  overrides: Record<string, ProviderOverrideDraft>
}

export type FieldError = { kind: 'required' } | { kind: 'integer' } | { kind: 'range'; min: number; max: number }

export interface ProviderOverrideErrors {
  resultsTtl?: FieldError
  emptyTtl?: FieldError
}

export interface CacheSettingsErrors {
  resultsTtl?: FieldError
  emptyTtl?: FieldError
  staleGrace?: FieldError
  maxStorageMb?: FieldError
  overrides: Record<string, ProviderOverrideErrors>
  tooManyOverrides: boolean
}

interface Range {
  min: number
  max: number
}

export function providerOverrideKey(entry: { namespace: MetadataCacheNamespace; provider: string }): string {
  return `${entry.namespace}:${entry.provider}`
}

function roundAmount(value: number): number {
  return Math.round(value * 100) / 100
}

/** Whole days read as days; anything else as hours, so a value set elsewhere is never rounded away. */
export function durationDraftFromSeconds(seconds: number): DurationDraft {
  if (seconds % UNIT_SECONDS.days === 0) return { amount: seconds / UNIT_SECONDS.days, unit: 'days' }
  return { amount: roundAmount(seconds / UNIT_SECONDS.hours), unit: 'hours' }
}

export function durationSeconds(duration: DurationDraft): number | null {
  if (duration.amount === null || !Number.isFinite(duration.amount)) return null
  return Math.round(duration.amount * UNIT_SECONDS[duration.unit])
}

function blankDuration(unit: DurationUnit): DurationDraft {
  return { amount: null, unit }
}

function overrideDraft(
  provider: MetadataCacheProviderInfo,
  existing: MetadataCacheProviderOverride | undefined,
  defaults: { resultsUnit: DurationUnit; emptyUnit: DurationUnit },
): ProviderOverrideDraft {
  return {
    namespace: provider.namespace,
    provider: provider.provider,
    enabled: existing?.enabled !== false,
    resultsTtl:
      existing?.resultsTtlSeconds !== undefined ? durationDraftFromSeconds(existing.resultsTtlSeconds) : blankDuration(defaults.resultsUnit),
    emptyTtl: existing?.emptyTtlSeconds !== undefined ? durationDraftFromSeconds(existing.emptyTtlSeconds) : blankDuration(defaults.emptyUnit),
  }
}

export function toCacheSettingsDraft(config: MetadataCacheConfig, providers: readonly MetadataCacheProviderInfo[]): CacheSettingsDraft {
  const resultsTtl = durationDraftFromSeconds(config.resultsTtlSeconds)
  const emptyTtl = durationDraftFromSeconds(config.emptyTtlSeconds)
  const existing = new Map(config.providerOverrides.map((override) => [providerOverrideKey(override), override]))
  const overrides: Record<string, ProviderOverrideDraft> = {}
  for (const provider of providers) {
    const key = providerOverrideKey(provider)
    overrides[key] = overrideDraft(provider, existing.get(key), { resultsUnit: resultsTtl.unit, emptyUnit: emptyTtl.unit })
  }
  return {
    enabled: config.enabled,
    resultsTtl,
    emptyTtl,
    staleGrace: durationDraftFromSeconds(config.staleGraceSeconds),
    maxStorageMb: config.maxStorageMb,
    overrides,
  }
}

export function resetProviderOverride(
  draft: ProviderOverrideDraft,
  defaults: { resultsUnit: DurationUnit; emptyUnit: DurationUnit },
): ProviderOverrideDraft {
  return {
    ...draft,
    enabled: true,
    resultsTtl: blankDuration(defaults.resultsUnit),
    emptyTtl: blankDuration(defaults.emptyUnit),
  }
}

export function providerOverrideIsSet(draft: ProviderOverrideDraft): boolean {
  return !draft.enabled || draft.resultsTtl.amount !== null || draft.emptyTtl.amount !== null
}

function validateDuration(duration: DurationDraft, range: Range, optional: boolean): FieldError | undefined {
  if (duration.amount === null) return optional ? undefined : { kind: 'required' }
  const seconds = durationSeconds(duration)
  if (seconds === null || duration.amount < 0 || seconds < range.min || seconds > range.max) {
    return { kind: 'range', min: range.min, max: range.max }
  }
  return undefined
}

function validateStorage(value: number | null): FieldError | undefined {
  if (value === null) return { kind: 'required' }
  if (!Number.isInteger(value)) return { kind: 'integer' }
  const range = METADATA_CACHE_LIMITS.maxStorageMb
  if (value < range.min || value > range.max) return { kind: 'range', min: range.min, max: range.max }
  return undefined
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T
}

export function validateCacheSettings(draft: CacheSettingsDraft, providers: readonly MetadataCacheProviderInfo[]): CacheSettingsErrors {
  const overrides: Record<string, ProviderOverrideErrors> = {}
  for (const provider of providers) {
    if (!provider.cacheable) continue
    const key = providerOverrideKey(provider)
    const entry = draft.overrides[key]
    if (!entry) continue
    const errors = compact<ProviderOverrideErrors>({
      resultsTtl: validateDuration(entry.resultsTtl, METADATA_CACHE_LIMITS.resultsTtlSeconds, true),
      emptyTtl: provider.cachesEmptyResults ? validateDuration(entry.emptyTtl, METADATA_CACHE_LIMITS.emptyTtlSeconds, true) : undefined,
    })
    if (Object.keys(errors).length > 0) overrides[key] = errors
  }
  return {
    ...compact({
      resultsTtl: validateDuration(draft.resultsTtl, METADATA_CACHE_LIMITS.resultsTtlSeconds, false),
      emptyTtl: validateDuration(draft.emptyTtl, METADATA_CACHE_LIMITS.emptyTtlSeconds, false),
      staleGrace: validateDuration(draft.staleGrace, METADATA_CACHE_LIMITS.staleGraceSeconds, false),
      maxStorageMb: validateStorage(draft.maxStorageMb),
    }),
    overrides,
    tooManyOverrides: buildProviderOverrides(draft, providers).length > METADATA_CACHE_LIMITS.maxProviderOverrides,
  }
}

export function hasCacheSettingsErrors(errors: CacheSettingsErrors): boolean {
  return (
    errors.tooManyOverrides ||
    errors.resultsTtl !== undefined ||
    errors.emptyTtl !== undefined ||
    errors.staleGrace !== undefined ||
    errors.maxStorageMb !== undefined ||
    Object.keys(errors.overrides).length > 0
  )
}

function buildProviderOverride(draft: ProviderOverrideDraft): MetadataCacheProviderOverride | null {
  if (!providerOverrideIsSet(draft)) return null
  const override: MetadataCacheProviderOverride = { namespace: draft.namespace, provider: draft.provider }
  if (!draft.enabled) override.enabled = false
  const resultsTtlSeconds = durationSeconds(draft.resultsTtl)
  if (resultsTtlSeconds !== null) override.resultsTtlSeconds = resultsTtlSeconds
  const emptyTtlSeconds = durationSeconds(draft.emptyTtl)
  if (emptyTtlSeconds !== null) override.emptyTtlSeconds = emptyTtlSeconds
  return override
}

/**
 * Only providers the server lists are sent: it rejects an override naming any other, so an
 * override left behind by a provider that has since been removed is dropped here.
 */
export function buildProviderOverrides(draft: CacheSettingsDraft, providers: readonly MetadataCacheProviderInfo[]): MetadataCacheProviderOverride[] {
  const overrides: MetadataCacheProviderOverride[] = []
  for (const provider of providers) {
    const entry = draft.overrides[providerOverrideKey(provider)]
    const override = entry ? buildProviderOverride(entry) : null
    if (override) overrides.push(override)
  }
  return overrides
}

/** The config the draft describes, or null while any field is blank or out of range. */
export function buildCacheConfig(draft: CacheSettingsDraft, providers: readonly MetadataCacheProviderInfo[]): MetadataCacheConfig | null {
  if (hasCacheSettingsErrors(validateCacheSettings(draft, providers))) return null
  const resultsTtlSeconds = durationSeconds(draft.resultsTtl)
  const emptyTtlSeconds = durationSeconds(draft.emptyTtl)
  const staleGraceSeconds = durationSeconds(draft.staleGrace)
  if (resultsTtlSeconds === null || emptyTtlSeconds === null || staleGraceSeconds === null || draft.maxStorageMb === null) return null
  return {
    enabled: draft.enabled,
    resultsTtlSeconds,
    emptyTtlSeconds,
    staleGraceSeconds,
    maxStorageMb: draft.maxStorageMb,
    providerOverrides: buildProviderOverrides(draft, providers),
  }
}

/** A comparable form of the draft, so switching 1 day to 24 hours does not read as an edit. */
export function cacheSettingsSnapshot(draft: CacheSettingsDraft, providers: readonly MetadataCacheProviderInfo[]): string {
  return JSON.stringify({
    enabled: draft.enabled,
    resultsTtl: durationSeconds(draft.resultsTtl),
    emptyTtl: durationSeconds(draft.emptyTtl),
    staleGrace: durationSeconds(draft.staleGrace),
    maxStorageMb: draft.maxStorageMb,
    overrides: buildProviderOverrides(draft, providers),
  })
}

/** Hits over lookups that reached the cache, or null before anything has been looked up. */
export function cacheHitRate(counters: { hits: number; misses: number }): number | null {
  const lookups = counters.hits + counters.misses
  return lookups > 0 ? counters.hits / lookups : null
}

/** Provider calls the cache answered instead: fresh hits plus fallbacks for providers that failed. */
export function cacheRequestsAvoided(counters: { hits: number; fallbacks: number }): number {
  return counters.hits + counters.fallbacks
}
