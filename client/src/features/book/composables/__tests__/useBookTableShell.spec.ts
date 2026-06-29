import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import type { BookCard } from '@bookorbit/types'

const mockSelectionMode = { value: false }
const mockSelectedIds = { value: new Set<number>() }

const mocks = vi.hoisted(() => ({
  enterSelectionMode: vi.fn<() => void>(),
  exitSelectionMode: vi.fn<() => void>(),
  toggleBook: vi.fn<(id: number) => void>(),
  promptDelete: vi.fn<(id: number) => void>(),
  cancelDelete: vi.fn<() => void>(),
  confirmDelete: vi.fn<() => void>(),
  routerPush: vi.fn<(to: unknown) => void>(),
  setBookContext: vi.fn<(ids: number[], total: number) => void>(),
  useBookBulkActions: vi.fn<(...args: unknown[]) => object>(() => ({
    handleBulkRefreshMetadata: vi.fn<() => void>(),
    handleBulkReExtractCover: vi.fn<() => void>(),
    handleBulkSetStatus: vi.fn<() => void>(),
    handleBulkSetRating: vi.fn<() => void>(),
    handleBulkSetField: vi.fn<() => void>(),
    handleBulkSetMetadataLock: vi.fn<() => void>(),
    handleDeleteSelected: vi.fn<() => void>(),
    handleDownloadFiles: vi.fn<() => void>(),
    inFlight: { value: null },
  })),
  useDeleteBookCallback: null as ((id: number) => void) | null,
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mocks.routerPush }),
}))

vi.mock('../useBookNavigation', () => ({
  useBookNavigation: () => ({ setBookContext: mocks.setBookContext }),
}))

vi.mock('../useTableViewControls', () => ({
  useTableViewControls: () => ({ tableRef: { value: null } }),
}))

vi.mock('../useBookViewSelection', () => ({
  useBookViewSelection: () => ({
    selectedIds: mockSelectedIds,
    selectionMode: mockSelectionMode,
    enterSelectionMode: mocks.enterSelectionMode,
    exitSelectionMode: mocks.exitSelectionMode,
    toggleBook: mocks.toggleBook,
    handleSelect: vi.fn<() => void>(),
    toggleSelectionMode: vi.fn<() => void>(),
  }),
}))

vi.mock('../useDeleteBook', () => ({
  useDeleteBook: (cb: (id: number) => void) => {
    mocks.useDeleteBookCallback = cb
    return {
      pendingId: { value: null },
      deleting: { value: false },
      promptDelete: mocks.promptDelete,
      cancelDelete: mocks.cancelDelete,
      confirmDelete: mocks.confirmDelete,
    }
  },
}))

vi.mock('../useBookBulkActions', () => ({
  useBookBulkActions: mocks.useBookBulkActions,
}))

import { useBookTableShell } from '../useBookTableShell'

function makeBook(overrides: Partial<BookCard> = {}): BookCard {
  return {
    id: 1,
    status: 'present',
    title: 'Test Book',
    authors: ['Test Author'],
    seriesName: null,
    seriesIndex: null,
    files: [],
    publishedYear: null,
    language: null,
    genres: [],
    tags: [],
    rating: null,
    readingProgress: null,
    readStatus: null,
    addedAt: '2026-01-01T00:00:00.000Z',
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
    ...overrides,
  }
}

describe('useBookTableShell', () => {
  beforeEach(() => {
    mockSelectionMode.value = false
    mockSelectedIds.value = new Set()
    mocks.enterSelectionMode.mockClear()
    mocks.exitSelectionMode.mockClear()
    mocks.toggleBook.mockClear()
    mocks.promptDelete.mockClear()
    mocks.cancelDelete.mockClear()
    mocks.confirmDelete.mockClear()
    mocks.useBookBulkActions.mockClear()
    mocks.routerPush.mockClear()
    mocks.setBookContext.mockClear()
  })

  it('wires useBookBulkActions without an onBulkRefreshCompleted callback', () => {
    const books = ref([makeBook()])
    useBookTableShell({ books })

    expect(mocks.useBookBulkActions).toHaveBeenCalledOnce()
    const call = mocks.useBookBulkActions.mock.calls[0]!
    const [, , , fourthArg] = call
    expect(fourthArg).toBeUndefined()
  })

  it('passes querySelection to useBookBulkActions', () => {
    const books = ref([makeBook()])
    const querySelection = ref(null)
    useBookTableShell({ books, querySelection })

    const call = mocks.useBookBulkActions.mock.calls[0]!
    const [, , , , fifthArg] = call
    expect(fifthArg).toBe(querySelection)
  })

  it('passes the books ref to useBookBulkActions', () => {
    const books = ref([makeBook()])
    useBookTableShell({ books })

    const call = mocks.useBookBulkActions.mock.calls[0]!
    const [, , thirdArg] = call
    expect(thirdArg).toBe(books)
  })

  describe('handleBookAction', () => {
    it('sets quickViewBookId and opens quick view for quick-view action', () => {
      const books = ref([makeBook({ id: 7 })])
      const { handleBookAction, quickViewBookId, quickViewOpen } = useBookTableShell({ books })

      handleBookAction(makeBook({ id: 7 }), 'quick-view')

      expect(quickViewBookId.value).toBe(7)
      expect(quickViewOpen.value).toBe(true)
    })

    it('enters selection mode and toggles the book for add-to-collection when not in selection mode', () => {
      mockSelectionMode.value = false
      const books = ref([makeBook({ id: 3 })])
      const { handleBookAction, addToCollectionOpen, quickViewOpen } = useBookTableShell({ books })
      quickViewOpen.value = true

      handleBookAction(makeBook({ id: 3 }), 'add-to-collection')

      expect(mocks.enterSelectionMode).toHaveBeenCalledOnce()
      expect(mocks.toggleBook).toHaveBeenCalledWith(3)
      expect(quickViewOpen.value).toBe(false)
      expect(addToCollectionOpen.value).toBe(true)
    })

    it('skips enterSelectionMode for add-to-collection when already in selection mode', () => {
      mockSelectionMode.value = true
      const books = ref([makeBook({ id: 3 })])
      const { handleBookAction, addToCollectionOpen, quickViewOpen } = useBookTableShell({ books })
      quickViewOpen.value = true

      handleBookAction(makeBook({ id: 3 }), 'add-to-collection')

      expect(mocks.enterSelectionMode).not.toHaveBeenCalled()
      expect(mocks.toggleBook).not.toHaveBeenCalled()
      expect(quickViewOpen.value).toBe(false)
      expect(addToCollectionOpen.value).toBe(true)
    })

    it('calls promptDelete for the delete action', () => {
      const books = ref([makeBook({ id: 5 })])
      const { handleBookAction, quickViewOpen } = useBookTableShell({ books })
      quickViewOpen.value = true

      handleBookAction(makeBook({ id: 5 }), 'delete')

      expect(quickViewOpen.value).toBe(false)
      expect(mocks.promptDelete).toHaveBeenCalledWith(5)
    })
  })

  describe('handleEditIndividually', () => {
    it('opens the topmost selected book on the details tab with the selection as context', () => {
      mockSelectedIds.value = new Set([30, 10])
      const books = ref([makeBook({ id: 10 }), makeBook({ id: 20 }), makeBook({ id: 30 })])
      const { handleEditIndividually } = useBookTableShell({ books })

      handleEditIndividually()

      expect(mocks.setBookContext).toHaveBeenCalledWith([10, 30], 2)
      expect(mocks.routerPush).toHaveBeenCalledWith({ name: 'book-detail', params: { bookId: 10 }, query: { tab: 'edit' } })
      expect(mocks.exitSelectionMode).toHaveBeenCalledOnce()
    })

    it('does nothing when no selected book is loaded in the list', () => {
      mockSelectedIds.value = new Set([999])
      const books = ref([makeBook({ id: 10 })])
      const { handleEditIndividually } = useBookTableShell({ books })

      handleEditIndividually()

      expect(mocks.setBookContext).not.toHaveBeenCalled()
      expect(mocks.routerPush).not.toHaveBeenCalled()
      expect(mocks.exitSelectionMode).not.toHaveBeenCalled()
    })
  })

  describe('handleTableBookUpdate', () => {
    it('replaces the matching book in the list', () => {
      const books = ref([makeBook({ id: 1, title: 'Original' }), makeBook({ id: 2, title: 'Other' })])
      const { handleTableBookUpdate } = useBookTableShell({ books })

      handleTableBookUpdate(makeBook({ id: 1, title: 'Updated' }))

      expect(books.value[0]?.title).toBe('Updated')
      expect(books.value[1]?.title).toBe('Other')
    })

    it('does not modify the list when the book id is not found', () => {
      const books = ref([makeBook({ id: 1, title: 'Unchanged' })])
      const { handleTableBookUpdate } = useBookTableShell({ books })

      handleTableBookUpdate(makeBook({ id: 999, title: 'Ghost' }))

      expect(books.value[0]?.title).toBe('Unchanged')
    })

    it('only replaces the first matching index when duplicate ids exist', () => {
      const books = ref([makeBook({ id: 1, title: 'A' }), makeBook({ id: 1, title: 'B' })])
      const { handleTableBookUpdate } = useBookTableShell({ books })

      handleTableBookUpdate(makeBook({ id: 1, title: 'Updated' }))

      expect(books.value[0]?.title).toBe('Updated')
      expect(books.value[1]?.title).toBe('B')
    })
  })

  describe('onDeleted single-book callback', () => {
    it('removes the deleted book from the list', () => {
      const books = ref([makeBook({ id: 10 }), makeBook({ id: 20 })])
      useBookTableShell({ books })

      mocks.useDeleteBookCallback!(10)

      expect(books.value.map((b) => b.id)).toEqual([20])
    })

    it('leaves list unchanged when deleted id is not present', () => {
      const books = ref([makeBook({ id: 10 })])
      useBookTableShell({ books })

      mocks.useDeleteBookCallback!(99)

      expect(books.value.map((b) => b.id)).toEqual([10])
    })
  })

  describe('bulk delete callback', () => {
    it('removes all deleted books and exits selection mode', () => {
      const books = ref([makeBook({ id: 1 }), makeBook({ id: 2 }), makeBook({ id: 3 })])
      useBookTableShell({ books })

      const call = mocks.useBookBulkActions.mock.calls[0]!
      const [, bulkDeleteCallback] = call as [unknown, (ids: number[]) => void]
      bulkDeleteCallback([1, 3])

      expect(books.value.map((b) => b.id)).toEqual([2])
      expect(mocks.exitSelectionMode).toHaveBeenCalledOnce()
    })

    it('exits selection mode even when ids array is empty', () => {
      const books = ref([makeBook({ id: 1 }), makeBook({ id: 2 })])
      useBookTableShell({ books })

      const call = mocks.useBookBulkActions.mock.calls[0]!
      const [, bulkDeleteCallback] = call as [unknown, (ids: number[]) => void]
      bulkDeleteCallback([])

      expect(books.value.map((b) => b.id)).toEqual([1, 2])
      expect(mocks.exitSelectionMode).toHaveBeenCalledOnce()
    })
  })

  it('exposes delete control refs and handlers', () => {
    const books = ref([makeBook()])
    const shell = useBookTableShell({ books })

    expect(shell.deleteBookId).toBeDefined()
    expect(shell.deletingBook).toBeDefined()
    expect(shell.promptDelete).toBe(mocks.promptDelete)
    expect(shell.cancelDelete).toBe(mocks.cancelDelete)
    expect(shell.confirmDelete).toBe(mocks.confirmDelete)
  })

  it('exposes dialog open refs initialised to false/null', () => {
    const books = ref([makeBook()])
    const shell = useBookTableShell({ books })

    expect(shell.addToCollectionOpen.value).toBe(false)
    expect(shell.sendBookOpen.value).toBe(false)
    expect(shell.quickViewOpen.value).toBe(false)
    expect(shell.quickViewBookId.value).toBeNull()
  })
})
