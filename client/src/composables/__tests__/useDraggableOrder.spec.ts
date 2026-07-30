import { describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { useDraggableOrder } from '../useDraggableOrder'

interface Item {
  id: number
  displayOrder: number
  name: string
}

function makeItems(): Item[] {
  return [
    { id: 1, displayOrder: 0, name: 'Alpha' },
    { id: 2, displayOrder: 1, name: 'Bravo' },
    { id: 3, displayOrder: 2, name: 'Charlie' },
  ]
}

function setup(persist = vi.fn<(order: { id: number; displayOrder: number }[]) => Promise<void>>().mockResolvedValue(undefined)) {
  const source = ref<Item[]>(makeItems())
  const scope = effectScope()
  const order = scope.run(() => useDraggableOrder({ source, persist, debounceMs: 10 }))
  if (!order) throw new Error('Expected useDraggableOrder to run inside the scope')
  return { ...order, source, persist, scope }
}

function key(name: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: name, cancelable: true })
}

function names(items: Item[]): string[] {
  return items.map((item) => item.name)
}

describe('useDraggableOrder keyboard reordering', () => {
  it('mirrors the source order before any interaction', () => {
    const { localItems, liftedId, status } = setup()

    expect(names(localItems.value)).toEqual(['Alpha', 'Bravo', 'Charlie'])
    expect(liftedId.value).toBeNull()
    expect(status.value).toBeNull()
  })

  it('lifts an item and announces its position', () => {
    const { handleGripKeydown, liftedId, status } = setup()

    handleGripKeydown(key(' '), 1)

    expect(liftedId.value).toBe(1)
    expect(status.value).toEqual({ kind: 'lifted', item: expect.objectContaining({ id: 1 }), position: 1, total: 3 })
  })

  it('moves a lifted item down and reports the new position', () => {
    const { handleGripKeydown, localItems, status } = setup()

    handleGripKeydown(key(' '), 1)
    handleGripKeydown(key('ArrowDown'), 1)

    expect(names(localItems.value)).toEqual(['Bravo', 'Alpha', 'Charlie'])
    expect(status.value).toMatchObject({ kind: 'moved', position: 2, total: 3 })
  })

  it('moves a lifted item up', () => {
    const { handleGripKeydown, localItems } = setup()

    handleGripKeydown(key(' '), 3)
    handleGripKeydown(key('ArrowUp'), 3)

    expect(names(localItems.value)).toEqual(['Alpha', 'Charlie', 'Bravo'])
  })

  it('does not move past either end of the list', () => {
    const { handleGripKeydown, localItems } = setup()

    handleGripKeydown(key(' '), 1)
    handleGripKeydown(key('ArrowUp'), 1)

    expect(names(localItems.value)).toEqual(['Alpha', 'Bravo', 'Charlie'])

    handleGripKeydown(key(' '), 1)
    handleGripKeydown(key(' '), 3)
    handleGripKeydown(key('ArrowDown'), 3)

    expect(names(localItems.value)).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })

  it('ignores arrow keys for an item that is not lifted', () => {
    const { handleGripKeydown, localItems } = setup()

    handleGripKeydown(key('ArrowDown'), 1)

    expect(names(localItems.value)).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })

  it('drops the item and persists the new order', async () => {
    vi.useFakeTimers()
    const { handleGripKeydown, liftedId, status, persist } = setup()

    handleGripKeydown(key(' '), 1)
    handleGripKeydown(key('ArrowDown'), 1)
    handleGripKeydown(key(' '), 1)

    expect(liftedId.value).toBeNull()
    expect(status.value).toMatchObject({ kind: 'dropped', position: 2, total: 3 })

    await vi.advanceTimersByTimeAsync(20)

    expect(persist).toHaveBeenCalledWith([
      { id: 2, displayOrder: 0 },
      { id: 1, displayOrder: 1 },
      { id: 3, displayOrder: 2 },
    ])
    vi.useRealTimers()
  })

  it('restores the pre-lift order on Escape without persisting', async () => {
    vi.useFakeTimers()
    const { handleGripKeydown, localItems, liftedId, status, persist } = setup()

    handleGripKeydown(key(' '), 1)
    handleGripKeydown(key('ArrowDown'), 1)
    handleGripKeydown(key('Escape'), 1)

    expect(names(localItems.value)).toEqual(['Alpha', 'Bravo', 'Charlie'])
    expect(liftedId.value).toBeNull()
    expect(status.value).toMatchObject({ kind: 'cancelled', position: 1, total: 3 })

    await vi.advanceTimersByTimeAsync(20)

    expect(persist).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('drops a lifted item when the grip loses focus', () => {
    const { handleGripKeydown, handleGripBlur, liftedId } = setup()

    handleGripKeydown(key(' '), 2)
    handleGripBlur(2)

    expect(liftedId.value).toBeNull()
  })

  it('rolls back to the pre-lift order when persisting fails', async () => {
    vi.useFakeTimers()
    const persist = vi.fn<(order: { id: number; displayOrder: number }[]) => Promise<void>>().mockRejectedValue(new Error('nope'))
    const { handleGripKeydown, localItems } = setup(persist)

    handleGripKeydown(key(' '), 1)
    handleGripKeydown(key('ArrowDown'), 1)
    handleGripKeydown(key(' '), 1)
    await vi.advanceTimersByTimeAsync(20)

    expect(names(localItems.value)).toEqual(['Alpha', 'Bravo', 'Charlie'])
    vi.useRealTimers()
  })

  it('does not let a source refresh overwrite a lift in progress', async () => {
    const { handleGripKeydown, localItems, source } = setup()

    handleGripKeydown(key(' '), 1)
    handleGripKeydown(key('ArrowDown'), 1)
    source.value = makeItems()
    await Promise.resolve()

    expect(names(localItems.value)).toEqual(['Bravo', 'Alpha', 'Charlie'])
  })
})
