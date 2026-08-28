import { describe, expect, it } from 'vitest'
import type { Collection } from '@bookorbit/types'
import { canMutateCollection, ownedCollectionOrder } from './collection-access'

function makeCollection(id: number, isOwner: boolean): Collection {
  return {
    id,
    userId: isOwner ? 7 : 99,
    name: `Collection ${id}`,
    icon: 'FolderOpen',
    description: null,
    isPublic: !isOwner,
    isOwner,
    syncToKobo: false,
    displayOrder: id,
    bookCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('collection access policy', () => {
  it('never treats public visibility as mutation authority', () => {
    expect(canMutateCollection(makeCollection(1, true))).toBe(true)
    expect(canMutateCollection(makeCollection(2, false))).toBe(false)
    expect(canMutateCollection(undefined)).toBe(false)
  })

  it('removes shared collection IDs before persisting sidebar order', () => {
    const collections = [makeCollection(1, true), makeCollection(2, false), makeCollection(3, true)]

    expect(
      ownedCollectionOrder(collections, [
        { id: 2, displayOrder: 0 },
        { id: 3, displayOrder: 1 },
        { id: 1, displayOrder: 2 },
      ]),
    ).toEqual([
      { id: 3, displayOrder: 1 },
      { id: 1, displayOrder: 2 },
    ])
  })
})
