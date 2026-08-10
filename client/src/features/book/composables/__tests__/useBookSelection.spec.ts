import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useBookSelection } from '../useBookSelection'

describe('useBookSelection', () => {
  it('uses a provided selection-mode ref as its source of truth', () => {
    const selectionMode = ref(false)
    const selection = useBookSelection(selectionMode)

    expect(selection.selectionMode).toBe(selectionMode)

    selection.enterSelectionMode()
    expect(selectionMode.value).toBe(true)

    selection.toggleBook(12)
    selection.exitSelectionMode()

    expect(selectionMode.value).toBe(false)
    expect(selection.selectedIds.value).toEqual(new Set())
  })

  it('creates an independent selection-mode ref when none is provided', () => {
    const first = useBookSelection()
    const second = useBookSelection()

    first.enterSelectionMode()

    expect(first.selectionMode.value).toBe(true)
    expect(second.selectionMode.value).toBe(false)
  })
})
