import type { BookMetadataFetchConditions, BookMetadataFetchConfig, BookMetadataFetchConfigOverride, MetadataField } from '@bookorbit/types'
import { ALL_METADATA_FIELDS } from '@bookorbit/types'

export type ConditionKey = keyof BookMetadataFetchConditions
export type OverrideKey = ConditionKey | 'onImport'
export type OnImportChoice = 'follow' | 'on' | 'off'

export const CONDITION_KEYS: ConditionKey[] = ['neverFetched', 'scoreThreshold', 'missingFields']

/** Only a book with audio can lack these; the server skips them for every other book. */
export const AUDIO_ONLY_FIELDS: MetadataField[] = ['audioCover', 'narrators', 'duration', 'abridged']
export const EVERY_BOOK_FIELDS: MetadataField[] = ALL_METADATA_FIELDS.filter((field) => !AUDIO_ONLY_FIELDS.includes(field))

type Override = NonNullable<BookMetadataFetchConfigOverride>

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** Mirrors the server's merge: top-level keys first, then each condition on its own. */
export function mergeConfig(global: BookMetadataFetchConfig, override: BookMetadataFetchConfigOverride): BookMetadataFetchConfig {
  if (!override) return clone(global)
  const conditions = override.conditions ?? {}
  return {
    enabled: override.enabled ?? global.enabled,
    triggerOnImport: override.triggerOnImport ?? global.triggerOnImport,
    conditions: {
      neverFetched: { ...global.conditions.neverFetched, ...conditions.neverFetched },
      scoreThreshold: { ...global.conditions.scoreThreshold, ...conditions.scoreThreshold },
      missingFields: { ...global.conditions.missingFields, ...conditions.missingFields },
    },
  }
}

/**
 * Imports are queued only when both flags are on, and nothing else reads `enabled`, so the page shows them
 * as one switch and writes them together.
 */
export function fetchesOnImport(config: Pick<BookMetadataFetchConfig, 'enabled' | 'triggerOnImport'>): boolean {
  return config.enabled && config.triggerOnImport
}

export function withOnImport(config: BookMetadataFetchConfig, on: boolean): BookMetadataFetchConfig {
  return { ...clone(config), enabled: on, triggerOnImport: on }
}

export function conditionsEqual<K extends ConditionKey>(key: K, a: BookMetadataFetchConditions[K], b: BookMetadataFetchConditions[K]): boolean {
  if (key === 'missingFields') {
    const left = a as BookMetadataFetchConditions['missingFields']
    const right = b as BookMetadataFetchConditions['missingFields']
    return left.enabled === right.enabled && [...left.fields].sort().join('|') === [...right.fields].sort().join('|')
  }
  return JSON.stringify(a) === JSON.stringify(b)
}

export function overriddenKeys(override: BookMetadataFetchConfigOverride): OverrideKey[] {
  if (!override) return []
  const keys: OverrideKey[] = CONDITION_KEYS.filter((key) => override.conditions?.[key] !== undefined)
  if (override.enabled !== undefined || override.triggerOnImport !== undefined) keys.push('onImport')
  return keys
}

export function onImportChoice(override: BookMetadataFetchConfigOverride): OnImportChoice {
  if (!override || (override.enabled === undefined && override.triggerOnImport === undefined)) return 'follow'
  return override.enabled !== false && override.triggerOnImport !== false ? 'on' : 'off'
}

/** Drops empty pieces so a library with nothing of its own is stored as `null` and follows the global rule. */
export function tidyOverride(override: Override | null): BookMetadataFetchConfigOverride {
  if (!override) return null
  const next = clone(override)
  if (next.conditions && Object.keys(next.conditions).length === 0) delete next.conditions
  return Object.keys(next).length > 0 ? next : null
}

/**
 * Sets one condition for a library. A value equal to the global one is not stored, so the library goes back
 * to following that condition and picks up later global changes.
 */
export function setOverrideCondition<K extends ConditionKey>(
  global: BookMetadataFetchConfig,
  override: BookMetadataFetchConfigOverride,
  key: K,
  value: BookMetadataFetchConditions[K],
): BookMetadataFetchConfigOverride {
  const next: Override = override ? clone(override) : {}
  const conditions = { ...next.conditions }
  if (conditionsEqual(key, value, global.conditions[key])) delete conditions[key]
  else conditions[key] = clone(value)
  next.conditions = conditions
  return tidyOverride(next)
}

export function clearOverrideKey(override: BookMetadataFetchConfigOverride, key: OverrideKey | 'all'): BookMetadataFetchConfigOverride {
  if (!override || key === 'all') return null
  const next = clone(override)
  if (key === 'onImport') {
    delete next.enabled
    delete next.triggerOnImport
  } else if (next.conditions) {
    delete next.conditions[key]
  }
  return tidyOverride(next)
}

export function setOverrideOnImport(override: BookMetadataFetchConfigOverride, choice: OnImportChoice): BookMetadataFetchConfigOverride {
  const next: Override = override ? clone(override) : {}
  delete next.enabled
  delete next.triggerOnImport
  if (choice !== 'follow') {
    next.enabled = choice === 'on'
    next.triggerOnImport = choice === 'on'
  }
  return tidyOverride(next)
}

/** What the server stores for a library: `{}` is how the API clears an override back to `null`. */
export function overrideRequestBody(override: BookMetadataFetchConfigOverride): Override {
  return override ? clone(override) : {}
}

export function globalChangeCount(saved: BookMetadataFetchConfig, draft: BookMetadataFetchConfig): number {
  let changes = fetchesOnImport(saved) === fetchesOnImport(draft) ? 0 : 1
  for (const key of CONDITION_KEYS) if (!conditionsEqual(key, saved.conditions[key], draft.conditions[key])) changes += 1
  return changes
}

export function overrideChangeCount(saved: BookMetadataFetchConfigOverride, draft: BookMetadataFetchConfigOverride): number {
  let changes = onImportChoice(saved) === onImportChoice(draft) ? 0 : 1
  for (const key of CONDITION_KEYS) {
    const before = saved?.conditions?.[key]
    const after = draft?.conditions?.[key]
    if (before === undefined && after === undefined) continue
    if (before === undefined || after === undefined || !conditionsEqual(key, before as never, after as never)) changes += 1
  }
  return changes
}
