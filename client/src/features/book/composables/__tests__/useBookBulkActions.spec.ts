import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { BOOK_METADATA_LOCK_FIELDS, type BookCard, type UserBookStatus } from '@bookorbit/types'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<{ ok: boolean }>>(),
  toastSuccess: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(message: string) => void>(),
  bumpVersion: vi.fn<(bookId: number) => void>(),
  markRefreshing: vi.fn<(bookIds: number[]) => void>(),
  clearRefreshing: vi.fn<(bookIds: number[]) => void>(),
  exportBooks: vi.fn<(bookIds: number[], includeAll?: boolean, formatGroup?: string) => Promise<void>>(),
}))

vi.mock('@/lib/api', () => ({
  api: mocks.api,
}))

vi.mock('vue-sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    warning: vi.fn<(message: string) => void>(),
  },
}))

vi.mock('../useCoverVersions', () => ({
  useCoverVersions: () => ({
    bumpVersion: mocks.bumpVersion,
    coverUrl: vi.fn<(bookId: number) => string>(),
  }),
}))

vi.mock('../useRefreshingBooks', () => ({
  useRefreshingBooks: () => ({
    markRefreshing: mocks.markRefreshing,
    clearRefreshing: mocks.clearRefreshing,
  }),
}))

vi.mock('../useBookDownload', () => ({
  useBookDownload: () => ({
    exportBooks: mocks.exportBooks,
  }),
}))

import { useBookBulkActions, type QuerySelectionState } from '../useBookBulkActions'

function makeReadStatus(overrides: Partial<UserBookStatus> = {}): UserBookStatus {
  return {
    status: 'reading',
    source: 'manual',
    startedAt: '2026-04-01T00:00:00.000Z',
    finishedAt: null,
    updatedAt: '2026-04-02T00:00:00.000Z',
    ...overrides,
  }
}

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

function makeQuerySelection(overrides: Partial<QuerySelectionState> = {}): QuerySelectionState {
  return {
    libraryId: 5,
    filter: { type: 'group', join: 'AND', rules: [] },
    q: 'space opera',
    total: 500,
    ...overrides,
  }
}

describe('useBookBulkActions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-24T12:00:00.000Z'))
    mocks.api.mockReset()
    mocks.toastSuccess.mockReset()
    mocks.toastError.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('patches selected books with the new manual read status after a successful bulk update', async () => {
    mocks.api.mockResolvedValue({ ok: true })
    const selectedIds = ref(new Set([1, 2]))
    const books = ref([
      makeBook({ id: 1, readStatus: null }),
      makeBook({ id: 2, readStatus: makeReadStatus() }),
      makeBook({ id: 3, readStatus: null }),
    ])

    const { handleBulkSetStatus } = useBookBulkActions(selectedIds, vi.fn(), books)

    await handleBulkSetStatus('read')

    expect(books.value[0]?.readStatus).toEqual({
      status: 'read',
      source: 'manual',
      startedAt: '2026-04-24T12:00:00.000Z',
      finishedAt: '2026-04-24T12:00:00.000Z',
      updatedAt: '2026-04-24T12:00:00.000Z',
    })
    expect(books.value[1]?.readStatus).toEqual({
      status: 'read',
      source: 'manual',
      startedAt: '2026-04-01T00:00:00.000Z',
      finishedAt: '2026-04-24T12:00:00.000Z',
      updatedAt: '2026-04-24T12:00:00.000Z',
    })
    expect(books.value[2]?.readStatus).toBeNull()
  })

  it('patches selected books with the new rating after a successful bulk update', async () => {
    mocks.api.mockResolvedValue({ ok: true })
    const selectedIds = ref(new Set([1, 3]))
    const books = ref([makeBook({ id: 1, rating: null }), makeBook({ id: 2, rating: 2 }), makeBook({ id: 3, rating: 4 })])

    const { handleBulkSetRating } = useBookBulkActions(selectedIds, vi.fn(), books)

    await handleBulkSetRating(5)

    expect(books.value.map((book) => book.rating)).toEqual([5, 2, 5])
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Rated 2 books 5/5')
  })

  it('skips locked rating fields in local bulk rating updates', async () => {
    mocks.api.mockResolvedValue({ ok: true })
    const selectedIds = ref(new Set([1, 2, 3]))
    const books = ref([
      makeBook({ id: 1, rating: null, lockedFields: [] }),
      makeBook({ id: 2, rating: 2, lockedFields: ['rating'] }),
      makeBook({ id: 3, rating: 4, lockedFields: [] }),
    ])

    const { handleBulkSetRating } = useBookBulkActions(selectedIds, vi.fn(), books)

    await handleBulkSetRating(5)

    expect(books.value.map((book) => book.rating)).toEqual([5, 2, 5])
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Rated 2 books 5/5 (1 locked skipped)')
  })

  it('does not mutate local books when the bulk status request fails', async () => {
    mocks.api.mockResolvedValue({ ok: false })
    const selectedIds = ref(new Set([1]))
    const originalStatus = makeReadStatus({ status: 'reading' })
    const books = ref([makeBook({ id: 1, readStatus: originalStatus })])

    const { handleBulkSetStatus } = useBookBulkActions(selectedIds, vi.fn(), books)

    await handleBulkSetStatus('abandoned')

    expect(books.value[0]?.readStatus).toEqual(originalStatus)
    expect(mocks.toastError).toHaveBeenCalledWith('Failed to update status')
  })

  it('patches selected books with the new metadata lock state after a successful bulk update', async () => {
    mocks.api.mockResolvedValue({ ok: true })
    const selectedIds = ref(new Set([1, 3]))
    const books = ref([
      makeBook({ id: 1, hasMetadataLocks: false }),
      makeBook({ id: 2, hasMetadataLocks: false }),
      makeBook({ id: 3, hasMetadataLocks: true }),
    ])

    const { handleBulkSetMetadataLock } = useBookBulkActions(selectedIds, vi.fn(), books)

    await handleBulkSetMetadataLock(true)

    expect(books.value.map((book) => book.hasMetadataLocks)).toEqual([true, false, true])
    expect(books.value[0]?.lockedFields).toEqual([...BOOK_METADATA_LOCK_FIELDS])
    expect(books.value[1]?.lockedFields).toEqual([])
    expect(books.value[2]?.lockedFields).toEqual([...BOOK_METADATA_LOCK_FIELDS])
  })

  it('skips local field updates for selected books where that field is locked', async () => {
    mocks.api.mockResolvedValue({ ok: true })
    const selectedIds = ref(new Set([1, 2, 3]))
    const books = ref([
      makeBook({ id: 1, language: 'en', lockedFields: [] }),
      makeBook({ id: 2, language: 'de', lockedFields: ['language'] }),
      makeBook({ id: 3, language: 'it', lockedFields: [] }),
    ])

    const { handleBulkSetField } = useBookBulkActions(selectedIds, vi.fn(), books)

    await handleBulkSetField('language', 'fr')

    expect(books.value.map((book) => book.language)).toEqual(['fr', 'de', 'fr'])
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Updated language for 2 books (1 locked skipped)')
  })

  it('replaces relation list fields locally for editable books', async () => {
    mocks.api.mockResolvedValue({ ok: true })
    const selectedIds = ref(new Set([1, 2, 3]))
    const books = ref([
      makeBook({ id: 1, authors: ['Old A'], lockedFields: [] }),
      makeBook({ id: 2, authors: ['Old B'], lockedFields: ['authors'] }),
      makeBook({ id: 3, authors: ['Old C'], lockedFields: [] }),
    ])

    const { handleBulkSetField } = useBookBulkActions(selectedIds, vi.fn(), books)

    await handleBulkSetField('authors', ['New A', 'New B'])

    expect(books.value.map((book) => book.authors)).toEqual([['New A', 'New B'], ['Old B'], ['New A', 'New B']])
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Updated authors for 2 books (1 locked skipped)')
  })

  it('sends bulk status updates using query selection payloads', async () => {
    mocks.api.mockResolvedValue({ ok: true })
    const selectedIds = ref(new Set<number>())
    const querySelection = ref<QuerySelectionState | null>(makeQuerySelection())

    const { handleBulkSetStatus } = useBookBulkActions(selectedIds, vi.fn(), undefined, undefined, querySelection)

    await handleBulkSetStatus('read')

    expect(mocks.api).toHaveBeenCalledWith(
      '/api/v1/books/bulk-set-status',
      expect.objectContaining({
        body: JSON.stringify({
          query: { libraryId: 5, filter: { type: 'group', join: 'AND', rules: [] }, q: 'space opera' },
          status: 'read',
        }),
      }),
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Updated status for 500 books')
  })

  it('forwards query sort specs in bulk payloads', async () => {
    mocks.api.mockResolvedValue({ ok: true })
    const selectedIds = ref(new Set<number>())
    const querySelection = ref<QuerySelectionState | null>(
      makeQuerySelection({
        sort: [{ field: 'title', dir: 'asc' }],
      }),
    )

    const { handleBulkSetStatus } = useBookBulkActions(selectedIds, vi.fn(), undefined, undefined, querySelection)

    await handleBulkSetStatus('reading')

    expect(mocks.api).toHaveBeenCalledWith(
      '/api/v1/books/bulk-set-status',
      expect.objectContaining({
        body: JSON.stringify({
          query: {
            libraryId: 5,
            filter: { type: 'group', join: 'AND', rules: [] },
            q: 'space opera',
            sort: [{ field: 'title', dir: 'asc' }],
          },
          status: 'reading',
        }),
      }),
    )
  })

  it('sends bulk rating updates using query selection payloads', async () => {
    mocks.api.mockResolvedValue({ ok: true })
    const selectedIds = ref(new Set<number>())
    const querySelection = ref<QuerySelectionState | null>(makeQuerySelection())

    const { handleBulkSetRating } = useBookBulkActions(selectedIds, vi.fn(), undefined, undefined, querySelection)

    await handleBulkSetRating(4)

    expect(mocks.api).toHaveBeenCalledWith(
      '/api/v1/books/bulk-set-rating',
      expect.objectContaining({
        body: JSON.stringify({
          query: { libraryId: 5, filter: { type: 'group', join: 'AND', rules: [] }, q: 'space opera' },
          rating: 4,
        }),
      }),
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Rated 500 books 4/5')
  })

  it('sends bulk tag updates using query selection payloads', async () => {
    mocks.api.mockResolvedValue({ ok: true })
    const selectedIds = ref(new Set<number>())
    const querySelection = ref<QuerySelectionState | null>(makeQuerySelection())

    const { handleBulkUpdateTags } = useBookBulkActions(selectedIds, vi.fn(), undefined, undefined, querySelection)

    await handleBulkUpdateTags('add', ['favorite'])

    expect(mocks.api).toHaveBeenCalledWith(
      '/api/v1/books/bulk-update-tags',
      expect.objectContaining({
        body: JSON.stringify({
          query: { libraryId: 5, filter: { type: 'group', join: 'AND', rules: [] }, q: 'space opera' },
          mode: 'add',
          tags: ['favorite'],
        }),
      }),
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Added tags to 500 books')
  })

  it('sends bulk field updates using query selection payloads', async () => {
    mocks.api.mockResolvedValue({ ok: true })
    const selectedIds = ref(new Set<number>())
    const querySelection = ref<QuerySelectionState | null>(makeQuerySelection())

    const { handleBulkSetField } = useBookBulkActions(selectedIds, vi.fn(), undefined, undefined, querySelection)

    await handleBulkSetField('language', 'fr')

    expect(mocks.api).toHaveBeenCalledWith(
      '/api/v1/books/bulk-set-metadata',
      expect.objectContaining({
        body: JSON.stringify({
          query: { libraryId: 5, filter: { type: 'group', join: 'AND', rules: [] }, q: 'space opera' },
          field: 'language',
          value: 'fr',
        }),
      }),
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Updated language for 500 books')
  })

  it('sends bulk metadata lock updates using query selection payloads', async () => {
    mocks.api.mockResolvedValue({ ok: true })
    const selectedIds = ref(new Set<number>())
    const querySelection = ref<QuerySelectionState | null>(makeQuerySelection())

    const { handleBulkSetMetadataLock } = useBookBulkActions(selectedIds, vi.fn(), undefined, undefined, querySelection)

    await handleBulkSetMetadataLock(true)

    expect(mocks.api).toHaveBeenCalledWith(
      '/api/v1/books/bulk-set-metadata-lock',
      expect.objectContaining({
        body: JSON.stringify({
          query: { libraryId: 5, filter: { type: 'group', join: 'AND', rules: [] }, q: 'space opera' },
          locked: true,
        }),
      }),
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Locked metadata for 500 books')
  })

  it('sends delete requests using query selection payloads', async () => {
    mocks.api.mockResolvedValue({ ok: true })
    const selectedIds = ref(new Set<number>())
    const onDeleted = vi.fn<(ids: number[]) => void>()
    const querySelection = ref<QuerySelectionState | null>(makeQuerySelection())

    const { handleDeleteSelected } = useBookBulkActions(selectedIds, onDeleted, undefined, undefined, querySelection)

    await handleDeleteSelected()

    expect(mocks.api).toHaveBeenCalledWith(
      '/api/v1/books',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({
          query: { libraryId: 5, filter: { type: 'group', join: 'AND', rules: [] }, q: 'space opera' },
        }),
      }),
    )
    expect(onDeleted).toHaveBeenCalledWith([])
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Deleted 500 books')
  })
})
