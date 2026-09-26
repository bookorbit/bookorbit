import type { Collection } from '@bookorbit/types'

export function canMutateCollection(collection: Collection | null | undefined): boolean {
  return collection?.isOwner === true
}
