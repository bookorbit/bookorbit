import type { Collection } from '@bookorbit/types'

export function canMutateCollection(collection: Collection | null | undefined): boolean {
  return collection?.isOwner === true
}

export function ownedCollectionOrder(
  collections: readonly Collection[],
  order: readonly { id: number; displayOrder: number }[],
): { id: number; displayOrder: number }[] {
  const ownedIds = new Set(collections.filter(canMutateCollection).map((collection) => collection.id))
  return order.filter((entry) => ownedIds.has(entry.id))
}
