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

export type PersistOrder = (order: DisplayOrderEntry[]) => Promise<void>

interface MediaOrderSources {
  /** The rows the user may reorder in each medium, read at persist time. */
  books: () => Identified[]
  podcasts: () => Identified[]
  reorder: PersistOrder
}

/**
 * One persist function per medium for a list whose books and podcasts share a displayOrder run.
 * Each keeps the other medium's current order and rewrites the whole run in one request.
 */
export function mediaOrderPersisters(sources: MediaOrderSources): { books: PersistOrder; podcasts: PersistOrder } {
  return {
    async books(order) {
      const books = ownedInOrder(order, sources.books())
      if (books.length === 0) return
      await sources.reorder(mergedMediaOrder(books, sources.podcasts()))
    },
    async podcasts(order) {
      const podcasts = ownedInOrder(order, sources.podcasts())
      if (podcasts.length === 0) return
      await sources.reorder(mergedMediaOrder(sources.books(), podcasts))
    },
  }
}
