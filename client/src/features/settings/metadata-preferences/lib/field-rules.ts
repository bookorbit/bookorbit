import { ALL_METADATA_FIELDS } from '@bookorbit/types'
import type { FieldPreference, MetadataField, MetadataProviderKey, ProviderStatus } from '@bookorbit/types'

/** Display grouping for the rule table. Every metadata field belongs to exactly one group. */
export const FIELD_GROUPS: { id: string; fields: MetadataField[] }[] = [
  { id: 'core', fields: ['title', 'subtitle', 'description', 'cover'] },
  { id: 'contributors', fields: ['authors'] },
  { id: 'publication', fields: ['publisher', 'publishedYear', 'language', 'pageCount', 'communityRating'] },
  { id: 'series', fields: ['seriesName', 'seriesIndex'] },
  { id: 'classification', fields: ['genres'] },
  { id: 'audiobook', fields: ['narrators', 'duration', 'abridged'] },
]

/** Why a provider that sits in a priority order will not be consulted. */
export type ProviderSkipReason = 'disabled' | 'notConfigured'

export type ProviderBulkAction = 'first' | 'last' | 'remove'

export function skipReasonFor(status: ProviderStatus | undefined): ProviderSkipReason | null {
  if (!status) return null
  if (!status.enabled) return 'disabled'
  if (!status.configured) return 'notConfigured'
  return null
}

/**
 * A provider with no status entry counts as usable: an unknown key is stale data rather
 * than a broken provider, and hiding it would leave no way to remove it.
 */
export function isProviderUsable(provider: MetadataProviderKey, statuses: ProviderStatus[]): boolean {
  const status = statuses.find((entry) => entry.key === provider)
  return status ? status.enabled && status.configured : true
}

/** The providers that will actually be consulted, in priority order. */
export function resolvedProviders(providers: MetadataProviderKey[], statuses: ProviderStatus[]): MetadataProviderKey[] {
  return providers.filter((provider) => isProviderUsable(provider, statuses))
}

/** The providers that stay in the order but are skipped on every fetch. */
export function skippedProviders(providers: MetadataProviderKey[], statuses: ProviderStatus[]): MetadataProviderKey[] {
  return providers.filter((provider) => !isProviderUsable(provider, statuses))
}

/**
 * Display rank for a provider, counting only the ones that will run. A skipped provider
 * has no rank because it never takes a turn, so numbering it would overstate the order.
 */
export function providerRank(providers: MetadataProviderKey[], index: number, statuses: ProviderStatus[]): number | null {
  const provider = providers[index]
  if (!provider || !isProviderUsable(provider, statuses)) return null
  return providers.slice(0, index + 1).filter((entry) => isProviderUsable(entry, statuses)).length
}

export function applyProviderAction(
  providers: MetadataProviderKey[],
  provider: MetadataProviderKey,
  action: ProviderBulkAction,
): MetadataProviderKey[] {
  const without = providers.filter((entry) => entry !== provider)
  if (action === 'remove') return without
  if (!providers.includes(provider)) return providers
  return action === 'first' ? [provider, ...without] : [...without, provider]
}

/** How many fields in a scope currently list the given provider. */
export function providerUsageCount(fields: Record<MetadataField, FieldPreference>, provider: MetadataProviderKey): number {
  return ALL_METADATA_FIELDS.filter((field) => fields[field]?.providers.includes(provider)).length
}

export interface FieldFilter {
  query: string
  provider: MetadataProviderKey | null
  overriddenOnly: boolean
  overridden: Set<MetadataField>
}

export function fieldsMatching(
  fields: Record<MetadataField, FieldPreference>,
  filter: FieldFilter,
  label: (field: MetadataField) => string,
): Set<MetadataField> {
  const query = filter.query.trim().toLocaleLowerCase()
  return new Set(
    ALL_METADATA_FIELDS.filter((field) => {
      if (query && !label(field).toLocaleLowerCase().includes(query)) return false
      if (filter.provider && !fields[field]?.providers.includes(filter.provider)) return false
      if (filter.overriddenOnly && !filter.overridden.has(field)) return false
      return true
    }),
  )
}
