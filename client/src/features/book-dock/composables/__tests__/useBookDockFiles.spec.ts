import { describe, expect, it } from 'vitest'
import { useBookDockFiles } from '../useBookDockFiles'

describe('useBookDockFiles deleted selections', () => {
  it('removes a deleted file from an explicit selection', () => {
    const files = useBookDockFiles()
    files.total.value = 3
    files.toggleSelect(1)
    files.toggleSelect(2)

    files.removeDeletedSelection(1)

    expect(files.selectionCount.value).toBe(1)
    expect(files.isSelected(1)).toBe(false)
    expect(files.isSelected(2)).toBe(true)
  })

  it('keeps all remaining matches selected after deleting an excluded row', () => {
    const files = useBookDockFiles()
    files.total.value = 3
    files.toggleSelectAll()
    files.toggleSelect(1)
    expect(files.selectionCount.value).toBe(2)

    files.removeDeletedSelection(1)
    files.total.value = 2

    expect(files.selectionCount.value).toBe(2)
    expect(files.isSelected(2)).toBe(true)
    expect(files.isSelected(3)).toBe(true)
  })
})
