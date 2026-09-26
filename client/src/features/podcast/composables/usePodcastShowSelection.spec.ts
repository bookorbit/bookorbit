// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { usePodcastShowSelection } from './usePodcastShowSelection'

describe('usePodcastShowSelection', () => {
  it('starts inactive and empty', () => {
    const selection = usePodcastShowSelection()

    expect(selection.active.value).toBe(false)
    expect(selection.count.value).toBe(0)
    expect(selection.hasSelection.value).toBe(false)
    expect(selection.ids.value).toEqual([])
  })

  it('toggles one show on and back off', () => {
    const selection = usePodcastShowSelection()

    selection.toggle(3)
    expect(selection.isSelected(3)).toBe(true)
    expect(selection.count.value).toBe(1)

    selection.toggle(3)
    expect(selection.isSelected(3)).toBe(false)
    expect(selection.count.value).toBe(0)
  })

  it('adds to the selection rather than replacing it when selecting all', () => {
    const selection = usePodcastShowSelection()

    selection.toggle(9)
    selection.selectAll([3, 4])

    expect([...selection.ids.value].sort((a, b) => a - b)).toEqual([3, 4, 9])
  })

  it('counts a repeated show once', () => {
    const selection = usePodcastShowSelection()

    selection.selectAll([3, 3, 4])

    expect(selection.count.value).toBe(2)
  })

  it('drops the selection when select mode is left', () => {
    const selection = usePodcastShowSelection()
    selection.setActive(true)
    selection.selectAll([3, 4])

    selection.toggleActive()

    expect(selection.active.value).toBe(false)
    expect(selection.count.value).toBe(0)
  })

  it('keeps the selection while select mode stays on', () => {
    const selection = usePodcastShowSelection()
    selection.setActive(true)
    selection.selectAll([3])

    selection.setActive(true)

    expect(selection.count.value).toBe(1)
  })

  it('replaces the set on every change so watchers see it', () => {
    const selection = usePodcastShowSelection()
    const before = selection.selectedIds.value

    selection.toggle(3)

    expect(selection.selectedIds.value).not.toBe(before)
  })
})
