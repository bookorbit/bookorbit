import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, type EffectScope } from 'vue'
import type { BookCard, BookMergedEvent } from '@bookorbit/types'
import { useBookMergeSync } from '../useBookMergeSync'

vi.mock('../useBookEvents', () => ({ useBookEvents: () => ({ onBookMerged: vi.fn<(callback: (event: BookMergedEvent) => void) => void>() }) }))

function card(id: number): BookCard {
  return { id, libraryId: 1, title: `Book ${id}` } as unknown as BookCard
}

function merged(overrides: Partial<BookMergedEvent> = {}): BookMergedEvent {
  return { libraryId: 2, targetBookId: 90, sourceBookIds: [91], ...overrides }
}

let scope: EffectScope

beforeEach(() => {
  vi.useFakeTimers()
  scope = effectScope()
})

afterEach(() => {
  scope.stop()
  vi.useRealTimers()
})

function setup(affectsScope?: (event: BookMergedEvent) => boolean) {
  const books = ref<BookCard[]>([card(1), card(2)])
  const refresh = vi.fn<() => void>()
  const deselect = vi.fn<(ids: number[]) => void>()
  const sync = scope.run(() => useBookMergeSync({ books, deselect, refresh, affectsScope }))!
  return { books, refresh, deselect, ...sync }
}

describe('useBookMergeSync', () => {
  it('ignores a merge that touches no loaded card and no library on screen', () => {
    const { applyMerged, refresh } = setup(() => false)
    applyMerged(merged())
    vi.runAllTimers()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('reloads the listing when a merge across libraries brings the kept book into this library', () => {
    const { applyMerged, refresh, books } = setup((event) => event.libraryId === 1 || (event.sourceLibraryIds ?? []).includes(1))
    applyMerged(merged({ libraryId: 1, sourceLibraryIds: [1, 2] }))
    vi.runAllTimers()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(books.value.map((book) => book.id)).toEqual([1, 2])
  })

  it('drops merged-away cards and reloads when the merge touches the loaded cards', () => {
    const { applyMerged, refresh, deselect, books } = setup()
    applyMerged(merged({ targetBookId: 1, sourceBookIds: [2] }))
    expect(books.value.map((book) => book.id)).toEqual([1])
    expect(deselect).toHaveBeenCalledWith([2])
    vi.runAllTimers()
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
