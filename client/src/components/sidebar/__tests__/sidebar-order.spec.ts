import { describe, expect, it, vi } from 'vitest'
import { orderPersister, ownedInOrder, type DisplayOrderEntry } from '../sidebar-order'

/**
 * The sidebar's reorder persistence once sent scopes owned by other users, which the server
 * rejects wholesale.
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

describe('orderPersister', () => {
  function setup(owned = [{ id: 1 }, { id: 2 }]) {
    const reorder = vi.fn<(order: DisplayOrderEntry[]) => Promise<void>>().mockResolvedValue(undefined)
    const persist = orderPersister(() => owned, reorder)
    return { reorder, persist }
  }

  it('renumbers the reordered rows from zero with no gaps', async () => {
    const { reorder, persist } = setup()

    await persist([
      { id: 2, displayOrder: 4 },
      { id: 1, displayOrder: 7 },
    ])

    expect(reorder).toHaveBeenCalledWith([
      { id: 2, displayOrder: 0 },
      { id: 1, displayOrder: 1 },
    ])
  })

  it('leaves out rows the user may not reorder', async () => {
    const { reorder, persist } = setup()

    await persist([
      { id: 3, displayOrder: 0 },
      { id: 2, displayOrder: 1 },
      { id: 1, displayOrder: 2 },
    ])

    expect(reorder).toHaveBeenCalledWith([
      { id: 2, displayOrder: 0 },
      { id: 1, displayOrder: 1 },
    ])
  })

  it("sends nothing when none of the reordered rows are the user's", async () => {
    const { reorder, persist } = setup([{ id: 1 }])

    await persist([{ id: 9, displayOrder: 0 }])

    expect(reorder).not.toHaveBeenCalled()
  })

  it('reads the owned rows when persisting, so a list that changed since setup is honoured', async () => {
    const owned = [{ id: 1 }]
    const { reorder, persist } = setup(owned)
    owned.push({ id: 12 })

    await persist([
      { id: 12, displayOrder: 0 },
      { id: 1, displayOrder: 1 },
    ])

    expect(reorder.mock.calls[0]?.[0].map((entry) => entry.id)).toEqual([12, 1])
  })
})
