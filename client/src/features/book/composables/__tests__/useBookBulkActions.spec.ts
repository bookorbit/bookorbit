import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { BookCard, UserBookStatus } from '@projectx/types'

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

import { useBookBulkActions } from '../useBookBulkActions'

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
    rating: null,
    readingProgress: null,
    readStatus: null,
    addedAt: '2026-01-01T00:00:00.000Z',
    hasCover: false,
    hasMetadataLocks: false,
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
  })
})
