interface Identified {
  id: number
}

export interface DisplayOrderEntry {
  id: number
  displayOrder: number
}

/**
 * Scopes and collections share one displayOrder sequence per user across both media, so a reorder
 * inside one section has to rewrite the whole run: books take the low slots, podcasts follow.
 * Renumbering a single section from zero would collide with the other section's slots, and the
 * server's `(displayOrder, name)` ordering would then silently reshuffle it by name.
 */
export function mergedMediaOrder(books: Identified[], podcasts: Identified[]): DisplayOrderEntry[] {
  return [...books, ...podcasts].map((entry, index) => ({ id: entry.id, displayOrder: index }))
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
