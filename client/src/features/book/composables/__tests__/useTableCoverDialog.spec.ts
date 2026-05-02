import { describe, it, expect, beforeEach } from 'vitest'
import { useTableCoverDialog } from '../useTableCoverDialog'
import type { BookCard } from '@bookorbit/types'

function makeBook(overrides: Partial<BookCard> = {}): BookCard {
  return {
    id: 1,
    status: 'present',
    title: 'Test Book',
    authors: ['Author One'],
    seriesName: null,
    seriesIndex: null,
    files: [],
    publishedYear: null,
    language: null,
    genres: [],
    rating: null,
    readingProgress: null,
    readStatus: null,
    addedAt: '2025-01-01T00:00:00.000Z',
    updatedAt: null,
    metadataScore: null,
    hasCover: false,
    hasMetadataLocks: false,
    lockedFields: [],
    subtitle: null,
    publisher: null,
    pageCount: null,
    isbn13: null,
    narrators: [],
    tags: [],
    ...overrides,
  }
}

describe('useTableCoverDialog', () => {
  let selectionMode: boolean
  let emittedUpdates: BookCard[]
  let books: BookCard[]
  let dialog: ReturnType<typeof useTableCoverDialog>

  beforeEach(() => {
    selectionMode = false
    emittedUpdates = []
    books = [makeBook({ id: 1, hasCover: false }), makeBook({ id: 2, hasCover: true })]
    dialog = useTableCoverDialog(
      () => selectionMode,
      (updated) => emittedUpdates.push(updated),
      () => books,
    )
  })

  it('starts with coverDialogBook as null', () => {
    expect(dialog.coverDialogBook.value).toBeNull()
  })

  it('handleCoverClick sets coverDialogBook when not in selection mode', () => {
    const book = makeBook({ id: 1 })
    dialog.handleCoverClick(book)
    expect(dialog.coverDialogBook.value).toEqual(book)
  })

  it('handleCoverClick does nothing when in selection mode', () => {
    selectionMode = true
    dialog.handleCoverClick(makeBook({ id: 1 }))
    expect(dialog.coverDialogBook.value).toBeNull()
  })

  it('handleCoverDialogUpdateBook emits updated book with new hasCover', () => {
    dialog.handleCoverDialogUpdateBook(1, true)
    expect(emittedUpdates).toHaveLength(1)
    expect(emittedUpdates[0]!.id).toBe(1)
    expect(emittedUpdates[0]!.hasCover).toBe(true)
  })

  it('handleCoverDialogUpdateBook does not emit when book is not in books list', () => {
    dialog.handleCoverDialogUpdateBook(99, true)
    expect(emittedUpdates).toHaveLength(0)
  })

  it('handleCoverDialogUpdateBook updates the open coverDialogBook hasCover', () => {
    const book = makeBook({ id: 1, hasCover: false })
    dialog.handleCoverClick(book)
    dialog.handleCoverDialogUpdateBook(1, true)
    expect(dialog.coverDialogBook.value?.hasCover).toBe(true)
  })

  it('handleCoverDialogUpdateBook does not alter coverDialogBook for different id', () => {
    const book = makeBook({ id: 2, hasCover: false })
    dialog.handleCoverClick(book)
    dialog.handleCoverDialogUpdateBook(1, true)
    expect(dialog.coverDialogBook.value?.hasCover).toBe(false)
  })
})
