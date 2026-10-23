import { describe, expect, it, vi } from 'vitest'
import { mediaOrderPersisters, mergedMediaOrder, ownedInOrder, type DisplayOrderEntry } from '../sidebar-order'

/**
 * The sidebar's reorder persistence shipped two real bugs this covers: it sent scopes owned by
 * other users, which the server rejects wholesale, and it renumbered one medium's run without the
 * other, colliding their displayOrder slots.
 */
describe('ownedInOrder', () => {
  it('drops entries the user does not own, since one rejects the whole reorder', () => {
    const order = [
      { id: 1, displayOrder: 0 },
      { id: 2, displayOrder: 1 },
      { id: 3, displayOrder: 2 },
    ]

    expect(ownedInOrder(order, [{ id: 1 }, { id: 3 }])).toEqual([{ id: 1 }, { id: 3 }])
  })

  it('preserves the new order rather than the owner list order', () => {
    const order = [
      { id: 3, displayOrder: 0 },
      { id: 1, displayOrder: 1 },
    ]

    expect(ownedInOrder(order, [{ id: 1 }, { id: 3 }])).toEqual([{ id: 3 }, { id: 1 }])
  })

  it('returns nothing when the user owns none of them', () => {
    expect(ownedInOrder([{ id: 9, displayOrder: 0 }], [{ id: 1 }])).toEqual([])
  })

  it('returns nothing for an empty reorder', () => {
    expect(ownedInOrder([], [{ id: 1 }])).toEqual([])
  })
})

describe('mergedMediaOrder', () => {
  it('numbers books into the low slots and podcasts after them, with no gaps', () => {
    const merged = mergedMediaOrder([{ id: 1 }, { id: 2 }], [{ id: 10 }, { id: 11 }])

    expect(merged).toEqual([
      { id: 1, displayOrder: 0 },
      { id: 2, displayOrder: 1 },
      { id: 10, displayOrder: 2 },
      { id: 11, displayOrder: 3 },
    ])
  })

  it('never reuses a slot across the two media, so neither section reshuffles the other', () => {
    const merged = mergedMediaOrder([{ id: 1 }, { id: 2 }, { id: 3 }], [{ id: 10 }])
    const slots = merged.map((entry) => entry.displayOrder)

    expect(new Set(slots).size).toBe(slots.length)
    expect(slots).toEqual([0, 1, 2, 3])
  })

  it('handles either side being empty', () => {
    expect(mergedMediaOrder([], [{ id: 10 }])).toEqual([{ id: 10, displayOrder: 0 }])
    expect(mergedMediaOrder([{ id: 1 }], [])).toEqual([{ id: 1, displayOrder: 0 }])
    expect(mergedMediaOrder([], [])).toEqual([])
  })

  it('keeps the caller-supplied sequence within each medium', () => {
    const merged = mergedMediaOrder([{ id: 2 }, { id: 1 }], [{ id: 11 }, { id: 10 }])

    expect(merged.map((entry) => entry.id)).toEqual([2, 1, 11, 10])
  })
})

describe('mediaOrderPersisters', () => {
  function setup(books = [{ id: 1 }, { id: 2 }], podcasts = [{ id: 10 }, { id: 11 }]) {
    const reorder = vi.fn<(order: DisplayOrderEntry[]) => Promise<void>>().mockResolvedValue(undefined)
    const persist = mediaOrderPersisters({ books: () => books, podcasts: () => podcasts, reorder })
    return { reorder, persist }
  }

  it('rewrites the whole run with the reordered books ahead of the podcasts', async () => {
    const { reorder, persist } = setup()

    await persist.books([
      { id: 2, displayOrder: 0 },
      { id: 1, displayOrder: 1 },
    ])

    expect(reorder).toHaveBeenCalledWith([
      { id: 2, displayOrder: 0 },
      { id: 1, displayOrder: 1 },
      { id: 10, displayOrder: 2 },
      { id: 11, displayOrder: 3 },
    ])
  })

  it('keeps the books in place when the podcasts are reordered', async () => {
    const { reorder, persist } = setup()

    await persist.podcasts([
      { id: 11, displayOrder: 0 },
      { id: 10, displayOrder: 1 },
    ])

    expect(reorder).toHaveBeenCalledWith([
      { id: 1, displayOrder: 0 },
      { id: 2, displayOrder: 1 },
      { id: 11, displayOrder: 2 },
      { id: 10, displayOrder: 3 },
    ])
  })

  it('leaves out rows the user may not reorder', async () => {
    const { reorder, persist } = setup([{ id: 1 }, { id: 2 }])

    await persist.books([
      { id: 3, displayOrder: 0 },
      { id: 2, displayOrder: 1 },
      { id: 1, displayOrder: 2 },
    ])

    expect(reorder.mock.calls[0]?.[0].map((entry) => entry.id)).toEqual([2, 1, 10, 11])
  })

  it("sends nothing when none of the reordered rows are the user's", async () => {
    const { reorder, persist } = setup([{ id: 1 }])

    await persist.books([{ id: 9, displayOrder: 0 }])

    expect(reorder).not.toHaveBeenCalled()
  })

  it('reads both lists when persisting, so a list that changed since setup is not overwritten', async () => {
    const podcasts = [{ id: 10 }]
    const { reorder, persist } = setup([{ id: 1 }], podcasts)
    podcasts.push({ id: 12 })

    await persist.books([{ id: 1, displayOrder: 0 }])

    expect(reorder.mock.calls[0]?.[0].map((entry) => entry.id)).toEqual([1, 10, 12])
  })
})
