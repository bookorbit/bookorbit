export const METADATA_TABS = ['providers', 'field-rules', 'custom-fields', 'score', 'auto-fetch', 'authors', 'genre-blocklist'] as const

export type MetadataTab = (typeof METADATA_TABS)[number]

export function normalizeMetadataTab(value: unknown): MetadataTab {
  if (typeof value === 'string' && METADATA_TABS.includes(value as MetadataTab)) {
    return value as MetadataTab
  }
  return 'providers'
}
