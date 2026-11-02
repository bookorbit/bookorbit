interface Identified {
  id: number
}

export interface DisplayOrderEntry {
  id: number
  displayOrder: number
}

/**
 * The reordered entries the user actually owns, in their new order.
 *
 * Shared scopes appear in the list but belong to their owner. The reorder endpoint updates only
 * rows the caller owns and rejects the whole payload when the updated count falls short, so
 * including one fails the entire operation.
 */
export function ownedInOrder(order: DisplayOrderEntry[], owned: Identified[]): Identified[] {
  const ownedIds = new Set(owned.map((entry) => entry.id))
  return order.filter((entry) => ownedIds.has(entry.id)).map((entry) => ({ id: entry.id }))
}

export type PersistOrder = (order: DisplayOrderEntry[]) => Promise<void>

/**
 * Persists a reordered section: only the rows the user may reorder, read at persist time, and
 * renumbered from zero with no gaps.
 */
export function orderPersister(owned: () => Identified[], reorder: PersistOrder): PersistOrder {
  return async (order) => {
    const entries = ownedInOrder(order, owned())
    if (entries.length === 0) return
    await reorder(entries.map((entry, index) => ({ id: entry.id, displayOrder: index })))
  }
}
