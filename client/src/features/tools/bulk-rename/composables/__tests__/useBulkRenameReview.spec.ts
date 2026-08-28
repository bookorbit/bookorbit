import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { BulkRenamePreviewItem } from '@bookorbit/types'

import { useBulkRenameReview } from '../useBulkRenameReview'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

function renameable(bookId: number, folder = 'Author'): BulkRenamePreviewItem {
  return {
    bookId,
    title: `Book ${bookId}`,
    status: 'will_rename',
    currentPath: `${folder}/Book ${bookId}/Book ${bookId}.epub`,
    newPath: `${folder}/Book ${bookId}.epub`,
  } as BulkRenamePreviewItem
}

function heldBack(bookId: number): BulkRenamePreviewItem {
  return {
    bookId,
    title: `Book ${bookId}`,
    status: 'collision',
    currentPath: `Author/Book ${bookId}.epub`,
    newPath: `Author/Taken.epub`,
  } as BulkRenamePreviewItem
}

/** Loaded rows are a slice; the server total is what the counts must follow. */
function setup(items: BulkRenamePreviewItem[], total = items.filter((i) => i.status === 'will_rename').length) {
  return useBulkRenameReview(ref(items), ref(total))
}

describe('useBulkRenameReview selection', () => {
  it('starts with every candidate selected and sends an empty exclusion', () => {
    const review = setup([renameable(1), renameable(2)])

    expect(review.selectedCount.value).toBe(2)
    expect(review.selectionState.value).toBe('all')
    expect(review.runSelection.value).toEqual({ excludeBookIds: [] })
  })

  it('counts every candidate, including books that have not loaded yet', () => {
    const review = setup([renameable(1), renameable(2)], 5000)

    expect(review.selectedCount.value).toBe(5000)
    expect(review.selectionState.value).toBe('all')
  })

  it('excludes a deselected book without needing the full candidate list', () => {
    const items = [renameable(1), renameable(2)]
    const review = setup(items, 5000)

    review.toggleSelected(items[0]!)

    expect(review.selectedCount.value).toBe(4999)
    expect(review.selectionState.value).toBe('some')
    expect(review.runSelection.value).toEqual({ excludeBookIds: [1] })
  })

  it('flips to an include list when the selection is cleared', () => {
    const items = [renameable(1), renameable(2)]
    const review = setup(items, 5000)

    review.selectNone()

    expect(review.selectedCount.value).toBe(0)
    expect(review.selectionState.value).toBe('none')
    expect(review.runSelection.value).toEqual({ includeBookIds: [] })

    review.toggleSelected(items[1]!)

    expect(review.selectedCount.value).toBe(1)
    expect(review.runSelection.value).toEqual({ includeBookIds: [2] })
  })

  it('returns to an exclusion list when everything is selected again', () => {
    const items = [renameable(1)]
    const review = setup(items, 5000)

    review.selectNone()
    review.selectAll()

    expect(review.selectedCount.value).toBe(5000)
    expect(review.runSelection.value).toEqual({ excludeBookIds: [] })
  })

  it('toggles the header between all and none', () => {
    const items = [renameable(1), renameable(2)]
    const review = setup(items)

    review.toggleAll()
    expect(review.selectionState.value).toBe('none')

    review.toggleAll()
    expect(review.selectionState.value).toBe('all')
  })

  it('treats a partial selection as a request to select everything', () => {
    const items = [renameable(1), renameable(2)]
    const review = setup(items)

    review.toggleSelected(items[0]!)
    expect(review.selectionState.value).toBe('some')

    review.toggleAll()
    expect(review.selectionState.value).toBe('all')
    expect(review.selectedCount.value).toBe(2)
  })

  it('never selects a book the preview held back', () => {
    const collision = heldBack(9)
    const review = setup([renameable(1), collision], 1)

    expect(review.isSelected(collision)).toBe(false)

    review.toggleSelected(collision)

    expect(review.selectedCount.value).toBe(1)
    expect(review.runSelection.value).toEqual({ excludeBookIds: [] })
  })

  it('reports group state over the rows that are loaded', () => {
    const items = [renameable(1), renameable(2)]
    const review = setup(items)
    const key = review.groups.value[0]!.key

    expect(review.groupState(key)).toBe('all')

    review.toggleSelected(items[0]!)
    expect(review.groupState(key)).toBe('some')

    review.toggleSelected(items[1]!)
    expect(review.groupState(key)).toBe('none')
  })

  it('clears and restores a whole group at once', () => {
    const items = [renameable(1), renameable(2)]
    const review = setup(items, 5000)
    const key = review.groups.value[0]!.key

    review.toggleGroupSelected(key)

    expect(review.groupState(key)).toBe('none')
    expect(review.runSelection.value).toEqual({ excludeBookIds: [1, 2] })

    review.toggleGroupSelected(key)

    expect(review.groupState(key)).toBe('all')
    expect(review.runSelection.value).toEqual({ excludeBookIds: [] })
  })

  it('adds a group to an empty selection without touching other groups', () => {
    const items = [renameable(1, 'A'), renameable(2, 'A'), heldBack(3)]
    const review = setup(items, 2)
    const key = review.groups.value.find((group) => group.items[0]!.status === 'will_rename')!.key

    review.selectNone()
    review.setGroupSelected(key, true)

    expect(review.runSelection.value).toEqual({ includeBookIds: [1, 2] })
    expect(review.selectedCount.value).toBe(2)
  })

  it('resets back to selecting everything', () => {
    const items = [renameable(1)]
    const review = setup(items)

    review.selectNone()
    review.reset()

    expect(review.selectionState.value).toBe('all')
    expect(review.runSelection.value).toEqual({ excludeBookIds: [] })
  })

  it('leaves nothing selected after a run, so skipped books stay skipped', () => {
    const items = [renameable(1), renameable(2)]
    const review = setup(items)

    review.toggleSelected(items[0]!)
    review.resetAfterRun()

    expect(review.selectionState.value).toBe('none')
    expect(review.selectedCount.value).toBe(0)
    expect(review.runSelection.value).toEqual({ includeBookIds: [] })
  })

  it('does not carry stale ids from the finished run into the next one', () => {
    const items = [renameable(1), renameable(2)]
    const review = setup(items)

    review.selectNone()
    review.toggleSelected(items[0]!)
    review.resetAfterRun()

    expect(review.runSelection.value).toEqual({ includeBookIds: [] })
  })

  it('closes the open row after a run because the list has changed', () => {
    const items = [renameable(1), renameable(2)]
    const review = setup(items)

    review.select(2)
    review.resetAfterRun()

    expect(review.selectedId.value).toBeNull()
  })
})
