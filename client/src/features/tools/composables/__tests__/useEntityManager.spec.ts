import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import type { BrowseEntityItem } from '@bookorbit/types'

import { useEntityManager } from '../useEntityManager'

type EntityManager = ReturnType<typeof useEntityManager>

function makeItem(id: number | string): BrowseEntityItem {
  return {
    id,
    name: `Entity ${id}`,
    bookCount: 1,
  }
}

function mountEntityManager(): { manager: EntityManager; unmount: () => void } {
  let manager: EntityManager | undefined
  const wrapper = mount(
    defineComponent({
      setup() {
        manager = useEntityManager()
        return () => h('div')
      },
    }),
  )

  return {
    manager: manager!,
    unmount: () => wrapper.unmount(),
  }
}

function selectedIds(manager: EntityManager): (number | string)[] {
  return Array.from(manager.selectedIds.value)
}

function selectedMapIds(manager: EntityManager): (number | string)[] {
  return Array.from(manager.selectedItemsMap.value.keys())
}

describe('useEntityManager selection', () => {
  it('selects an inclusive range from the anchor through the target in current browse order', () => {
    const { manager, unmount } = mountEntityManager()
    manager.browseItems.value = [1, 2, 3, 4, 5].map(makeItem)

    manager.toggleSelection(2)
    manager.rangeSelectTo(5)

    expect(selectedIds(manager)).toEqual([2, 3, 4, 5])
    expect(selectedMapIds(manager)).toEqual([2, 3, 4, 5])
    expect(manager.selectedItemsMap.value.get(4)?.name).toBe('Entity 4')

    unmount()
  })

  it('uses a deselected anchor to remove a range and keep cached selected items in sync', () => {
    const { manager, unmount } = mountEntityManager()
    manager.browseItems.value = [1, 2, 3, 4, 5].map(makeItem)

    for (const item of manager.browseItems.value) {
      manager.toggleSelection(item.id)
    }
    manager.toggleSelection(2)
    manager.rangeSelectTo(4)

    expect(selectedIds(manager)).toEqual([1, 5])
    expect(selectedMapIds(manager)).toEqual([1, 5])

    unmount()
  })

  it('falls back to a normal toggle when there is no valid range anchor on the current page', () => {
    const { manager, unmount } = mountEntityManager()
    manager.browseItems.value = [1, 2].map(makeItem)
    manager.toggleSelection(1)

    manager.browseItems.value = [3, 4, 5].map(makeItem)
    manager.rangeSelectTo(5)

    expect(selectedIds(manager)).toEqual([1, 5])
    expect(manager.selectedItemsMap.value.get(1)?.name).toBe('Entity 1')
    expect(manager.selectedItemsMap.value.get(5)?.name).toBe('Entity 5')

    unmount()
  })

  it('clears selected ids, cached items, and the range anchor together', () => {
    const { manager, unmount } = mountEntityManager()
    manager.browseItems.value = [1, 2, 3, 4].map(makeItem)

    manager.toggleSelection(2)
    manager.clearSelection()
    manager.rangeSelectTo(4)

    expect(selectedIds(manager)).toEqual([4])
    expect(selectedMapIds(manager)).toEqual([4])

    manager.clearBrowse()
    expect(selectedIds(manager)).toEqual([])
    expect(selectedMapIds(manager)).toEqual([])

    unmount()
  })
})
