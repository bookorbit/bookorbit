// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { BookSelectionPayload } from '@bookorbit/types'

import { useMoveToLibraryTarget } from '../useMoveToLibraryTarget'

function setup(selection: BookSelectionPayload = { bookIds: [1, 2, 3] }, count = 3) {
  const getSelectionPayload = vi.fn<() => BookSelectionPayload>(() => selection)
  const selectedCount = ref(count)
  return { getSelectionPayload, selectedCount, target: useMoveToLibraryTarget({ getSelectionPayload, selectedCount }) }
}

describe('selection moves', () => {
  it('uses the current selection and its count', () => {
    const { target } = setup()

    target.openForSelection()

    expect(target.open.value).toBe(true)
    expect(target.payload.value).toEqual({ bookIds: [1, 2, 3] })
    expect(target.count.value).toBe(3)
  })

  it('follows a query-scoped selection payload', () => {
    const query = { query: { libraryId: 4 } } as BookSelectionPayload
    const { target } = setup(query, 1204)

    target.openForSelection()

    expect(target.payload.value).toEqual(query)
    expect(target.count.value).toBe(1204)
  })

  it('tracks later changes to the selection count', () => {
    const { target, selectedCount } = setup()
    target.openForSelection()

    selectedCount.value = 7

    expect(target.count.value).toBe(7)
  })
})

describe('single-book moves', () => {
  it('scopes to the given book, ignoring any active selection', () => {
    const { target, getSelectionPayload } = setup()

    target.openForBook(42)

    expect(target.open.value).toBe(true)
    // The whole point: a quick move must not pick up an unrelated live selection.
    expect(target.payload.value).toEqual({ bookIds: [42] })
    expect(target.count.value).toBe(1)
    expect(getSelectionPayload).not.toHaveBeenCalled()
  })

  it('returns to the selection when reopened from the action bar', () => {
    const { target } = setup()
    target.openForBook(42)

    target.openForSelection()

    expect(target.payload.value).toEqual({ bookIds: [1, 2, 3] })
    expect(target.count.value).toBe(3)
  })
})

describe('closing', () => {
  it('drops the single-book scope so the next open is not stale', () => {
    const { target } = setup()
    target.openForBook(42)

    target.setOpen(false)

    expect(target.open.value).toBe(false)
    expect(target.quickBookId.value).toBeNull()
    expect(target.payload.value).toEqual({ bookIds: [1, 2, 3] })
  })

  it('keeps the scope while the sheet stays open', () => {
    const { target } = setup()
    target.openForBook(42)

    target.setOpen(true)

    expect(target.payload.value).toEqual({ bookIds: [42] })
  })
})
