import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { useListReorder } from '../useListReorder'

function key(name: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: name, cancelable: true })
}

function setup(initial = ['browse', 'libraries', 'reading']) {
  const source = ref(initial)
  const commit = vi.fn<(order: string[]) => void>()
  const reorder = useListReorder(() => source.value, commit)
  return { source, commit, ...reorder }
}

describe('useListReorder', () => {
  it('lifts, moves and drops with the keyboard, committing once on drop', () => {
    const { items, liftedId, status, commit, handleGripKeydown } = setup()

    handleGripKeydown(key(' '), 'reading')
    expect(liftedId.value).toBe('reading')
    expect(status.value).toEqual({ kind: 'lifted', id: 'reading', position: 3, total: 3 })

    handleGripKeydown(key('ArrowUp'), 'reading')
    handleGripKeydown(key('ArrowUp'), 'reading')
    expect(items.value).toEqual(['reading', 'browse', 'libraries'])
    expect(commit).not.toHaveBeenCalled()

    handleGripKeydown(key('Enter'), 'reading')
    expect(liftedId.value).toBeNull()
    expect(status.value?.kind).toBe('dropped')
    expect(commit).toHaveBeenCalledExactlyOnceWith(['reading', 'browse', 'libraries'])
  })

  it('puts the list back on Escape and claims the key', () => {
    const { items, commit, handleGripKeydown } = setup()

    handleGripKeydown(key(' '), 'browse')
    handleGripKeydown(key('ArrowDown'), 'browse')
    const escape = key('Escape')
    handleGripKeydown(escape, 'browse')

    expect(items.value).toEqual(['browse', 'libraries', 'reading'])
    expect(escape.defaultPrevented).toBe(true)
    expect(commit).not.toHaveBeenCalled()
  })

  it('leaves Escape alone when nothing is lifted', () => {
    const { handleGripKeydown } = setup()
    const escape = key('Escape')

    handleGripKeydown(escape, 'browse')

    expect(escape.defaultPrevented).toBe(false)
  })

  it('drops the lifted row when its grip loses focus', () => {
    const { commit, handleGripKeydown, handleGripBlur } = setup()

    handleGripKeydown(key(' '), 'libraries')
    handleGripKeydown(key('ArrowDown'), 'libraries')
    handleGripBlur('libraries')

    expect(commit).toHaveBeenCalledExactlyOnceWith(['browse', 'reading', 'libraries'])
  })

  it('commits a pointer drag on drop and ignores source updates mid-drag', async () => {
    const { source, items, commit, onDragStart, onDragEnd } = setup()

    onDragStart()
    items.value = ['libraries', 'browse', 'reading']
    source.value = ['browse', 'libraries', 'reading', 'collections']
    await nextTick()
    expect(items.value).toEqual(['libraries', 'browse', 'reading'])

    onDragEnd()
    expect(commit).toHaveBeenCalledExactlyOnceWith(['libraries', 'browse', 'reading'])
  })

  it('follows the source when idle', async () => {
    const { source, items } = setup()

    source.value = ['reading', 'browse']
    await nextTick()

    expect(items.value).toEqual(['reading', 'browse'])
  })
})
