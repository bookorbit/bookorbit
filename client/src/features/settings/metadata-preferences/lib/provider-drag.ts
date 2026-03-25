import type { MetadataProviderKey } from '@projectx/types'

export interface ProviderDragItem {
  key: MetadataProviderKey
  dragId: string
}

export const PROVIDER_DND_GROUP = 'metadata-preferences-provider'

let providerDragId = 0

export function createProviderDragItem(key: MetadataProviderKey): ProviderDragItem {
  providerDragId += 1
  return { key, dragId: `${key}:${providerDragId}` }
}

export function toProviderDragItems(providers: MetadataProviderKey[]): ProviderDragItem[] {
  return providers.map((key) => createProviderDragItem(key))
}

export function normalizeProviderOrder(items: ProviderDragItem[]): MetadataProviderKey[] {
  const next: MetadataProviderKey[] = []
  const seen = new Set<MetadataProviderKey>()
  for (const item of items) {
    if (seen.has(item.key)) continue
    seen.add(item.key)
    next.push(item.key)
  }
  return next
}
