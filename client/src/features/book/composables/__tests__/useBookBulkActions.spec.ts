import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { BOOK_METADATA_LOCK_FIELDS, type BookCard, type UserBookStatus } from '@bookorbit/types'

import { i18n } from '@/i18n'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<{ ok: boolean; body?: unknown }>>(),
  toastSuccess: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(message: string) => void>(),
  toastWarning: vi.fn<(message: string) => void>(),
  toastInfo: vi.fn<(message: string, options?: unknown) => void>(),
  actOnJobs: vi.fn<(request: { action: string; ids: string[] }) => Promise<{ results: { id: string; outcome: string; status: string | null }[] }>>(),
  bumpVersion: vi.fn<(bookId: number) => void>(),
  markRefreshing: vi.fn<(bookIds: number[]) => void>(),
  clearRefreshing: vi.fn<(bookIds: number[]) => void>(),
  exportBooks: vi.fn<(bookIds: number[], includeAll?: boolean, formatGroup?: string) => Promise<void>>(),
}))

function makeSseStream(lines: string[]): { ok: true; body: { getReader: () => { read: () => Promise<{ done: boolean; value?: Uint8Array }> } } } {
  const encoder = new TextEncoder()
  let index = 0
  return {
    ok: true,
    body: {
      getReader: () => ({
        async read() {
          if (index >= lines.length) return { done: true as const, value: undefined }
          const line = lines[index++]
          return { done: false as const, value: encoder.encode(line + '\n') }
        },
      }),
    },
  }
}

vi.mock('@/lib/api', () => ({
  api: mocks.api,
}))

vi.mock('vue-sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    warning: mocks.toastWarning,
    info: mocks.toastInfo,
  },
}))

vi.mock('@/features/jobs/api/jobs.api', () => ({ actOnJobs: mocks.actOnJobs }))

/** A bulk route's answer whose stream the test feeds by hand, naming its run in the header. */
function liveSse(runId = 'run-7') {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value
    },
  })
  return {
    response: { ok: true, status: 200, body, headers: new Headers({ 'X-Bulk-Run-Id': runId }) },
    send: (event: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)),
    close: () => controller.close(),
  }
}

const flushStream = () => new Promise((resolve) => setTimeout(resolve, 0))

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
    coverAspectRatio: '2/3',
    title: 'Test Book',
    authors: ['Test Author'],
    seriesName: null,
    seriesIndex: null,
    files: [],
    publishedDate: null,
    publishedYear: null,
    language: null,
    genres: [],
    tags: [],
    rating: null,
    readingProgress: null,
    readStatus: null,
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    coverVersion: 'legacy:2026-01-01T00:00:00.000Z',
    metadataScore: null,
    hasCover: false,
    hasMetadataLocks: false,
    lockedFields: [],
    subtitle: null,
    publisher: null,
    pageCount: null,
    isbn13: null,
    narrators: [],
    customMetadata: [],
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

  it('exposes explicit and query selection payloads for external bulk dialogs', () => {
    const selectedIds = ref(new Set([10, 20]))
    const inactiveQuerySelection = ref<QuerySelectionState | null>(null)
    const explicit = useBookBulkActions(selectedIds, vi.fn(), undefined, undefined, inactiveQuerySelection)

    expect(explicit.getSelectionPayload()).toEqual({ bookIds: [10, 20] })

    const querySelection = ref<QuerySelectionState | null>(makeQuerySelection({ sort: [{ field: 'title', dir: 'asc' }] }))
    const queryScoped = useBookBulkActions(ref(new Set<number>()), vi.fn(), undefined, undefined, querySelection)

    expect(queryScoped.getSelectionPayload()).toEqual({
      query: {
        libraryId: 5,
        filter: { type: 'group', join: 'AND', rules: [] },
        q: 'space opera',
        sort: [{ field: 'title', dir: 'asc' }],
      },
    })
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
      startedAt: null,
      finishedAt: null,
      updatedAt: '2026-04-24T12:00:00.000Z',
    })
    expect(books.value[1]?.readStatus).toEqual({
      status: 'read',
      source: 'manual',
      startedAt: '2026-04-01T00:00:00.000Z',
      finishedAt: null,
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
    expect(mocks.toastError).toHaveBeenCalledWith('Failed to update reading state')
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
    expect(books.value[0]?.lockedFields).toEqual(expect.arrayContaining(['cover', 'audioCover']))
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
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Updated reading state for 500 books')
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

  it('sends explicit reading dates and applies them to loaded books', async () => {
    mocks.api.mockResolvedValue({ ok: true })
    const selectedIds = ref(new Set([1]))
    const books = ref([makeBook({ id: 1, readStatus: makeReadStatus({ finishedAt: '2026-04-20' }) })])
    const { handleBulkSetStatus } = useBookBulkActions(selectedIds, vi.fn(), books)

    await handleBulkSetStatus({ status: 'read', startedAt: '2026-01-05', finishedAt: null })

    expect(mocks.api).toHaveBeenCalledWith(
      '/api/v1/books/bulk-set-status',
      expect.objectContaining({
        body: JSON.stringify({ bookIds: [1], status: 'read', startedAt: '2026-01-05', finishedAt: null }),
      }),
    )
    expect(books.value[0]?.readStatus).toMatchObject({ status: 'read', startedAt: '2026-01-05', finishedAt: null })
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

  it('bumps versions for all selected IDs after SSE stream even when no events are received', async () => {
    mocks.api.mockResolvedValue(makeSseStream([]))
    mocks.bumpVersion.mockReset()

    const selectedIds = ref(new Set([5, 6, 7]))
    const { handleBulkRefreshMetadata } = useBookBulkActions(selectedIds, vi.fn())

    await handleBulkRefreshMetadata()

    expect(mocks.bumpVersion).toHaveBeenCalledWith(5)
    expect(mocks.bumpVersion).toHaveBeenCalledWith(6)
    expect(mocks.bumpVersion).toHaveBeenCalledWith(7)
  })

  it('bumps version per SSE event and not before the stream for bulk metadata refresh', async () => {
    const order: string[] = []
    mocks.bumpVersion.mockImplementation((id: number) => order.push(`bump:${id}`))

    mocks.api.mockImplementation(async () => {
      order.push('api:called')
      return makeSseStream([
        `data: ${JSON.stringify({ bookId: 10, success: true })}`,
        `data: ${JSON.stringify({ bookId: 20, success: true })}`,
        `data: ${JSON.stringify({ done: true, processed: 2, failed: 0 })}`,
      ])
    })

    const selectedIds = ref(new Set([10, 20]))
    const { handleBulkRefreshMetadata } = useBookBulkActions(selectedIds, vi.fn())

    await handleBulkRefreshMetadata()

    expect(order.indexOf('api:called')).toBeLessThan(order.indexOf('bump:10'))
    expect(order.indexOf('api:called')).toBeLessThan(order.indexOf('bump:20'))
  })

  it('bumps version exactly once per book when all SSE events are received for bulk metadata refresh', async () => {
    mocks.api.mockResolvedValue(
      makeSseStream([
        `data: ${JSON.stringify({ bookId: 10, success: true })}`,
        `data: ${JSON.stringify({ bookId: 20, success: true })}`,
        `data: ${JSON.stringify({ done: true, processed: 2, failed: 0 })}`,
      ]),
    )
    mocks.bumpVersion.mockReset()

    const selectedIds = ref(new Set([10, 20]))
    const { handleBulkRefreshMetadata } = useBookBulkActions(selectedIds, vi.fn())

    await handleBulkRefreshMetadata()

    expect(mocks.bumpVersion.mock.calls.filter((c) => c[0] === 10).length).toBe(1)
    expect(mocks.bumpVersion.mock.calls.filter((c) => c[0] === 20).length).toBe(1)
  })

  it('bumps versions for books that receive no SSE event in finally for bulk metadata refresh', async () => {
    mocks.api.mockResolvedValue(
      makeSseStream([`data: ${JSON.stringify({ bookId: 10, success: true })}`, `data: ${JSON.stringify({ done: true, processed: 1, failed: 0 })}`]),
    )
    mocks.bumpVersion.mockReset()

    const selectedIds = ref(new Set([10, 20]))
    const { handleBulkRefreshMetadata } = useBookBulkActions(selectedIds, vi.fn())

    await handleBulkRefreshMetadata()

    expect(mocks.bumpVersion).toHaveBeenCalledWith(10)
    expect(mocks.bumpVersion).toHaveBeenCalledWith(20)
    expect(mocks.bumpVersion.mock.calls.filter((c) => c[0] === 10).length).toBe(1)
    expect(mocks.bumpVersion.mock.calls.filter((c) => c[0] === 20).length).toBe(1)
  })

  it('sends the bulk metadata refresh body unchanged unless cached results are ignored', async () => {
    mocks.api.mockResolvedValue(makeSseStream([`data: ${JSON.stringify({ done: true, processed: 0, failed: 0 })}`]))

    const selectedIds = ref(new Set([10, 20]))
    const { handleBulkRefreshMetadata } = useBookBulkActions(selectedIds, vi.fn())

    await handleBulkRefreshMetadata()
    await handleBulkRefreshMetadata({ ignoreCache: false })
    await handleBulkRefreshMetadata({ ignoreCache: true })

    const bodies = mocks.api.mock.calls
      .filter(([url]) => url === '/api/v1/books/bulk-refresh-metadata')
      .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>)
    expect(bodies).toEqual([{ bookIds: [10, 20] }, { bookIds: [10, 20] }, { bookIds: [10, 20], ignoreCache: true }])
  })

  it('adds ignoreCache to a query-scoped bulk metadata refresh only when asked', async () => {
    mocks.api.mockResolvedValue(makeSseStream([`data: ${JSON.stringify({ done: true, processed: 0, failed: 0 })}`]))

    const querySelection = ref<QuerySelectionState | null>(makeQuerySelection())
    const { handleBulkRefreshMetadata } = useBookBulkActions(ref(new Set<number>()), vi.fn(), undefined, undefined, querySelection)

    await handleBulkRefreshMetadata({ ignoreCache: true })

    const [, init] = mocks.api.mock.calls.find(([url]) => url === '/api/v1/books/bulk-refresh-metadata')!
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(body).toHaveProperty('query')
    expect(body).not.toHaveProperty('bookIds')
    expect(body.ignoreCache).toBe(true)
  })

  it('does not bump for query-selection books that received no SSE event', async () => {
    mocks.api.mockResolvedValue(
      makeSseStream([`data: ${JSON.stringify({ bookId: 42, success: true })}`, `data: ${JSON.stringify({ done: true, processed: 1, failed: 0 })}`]),
    )
    mocks.bumpVersion.mockReset()

    const selectedIds = ref(new Set<number>())
    const querySelection = ref<QuerySelectionState | null>(makeQuerySelection())
    const { handleBulkRefreshMetadata } = useBookBulkActions(selectedIds, vi.fn(), undefined, undefined, querySelection)

    await handleBulkRefreshMetadata()

    expect(mocks.bumpVersion).toHaveBeenCalledTimes(1)
    expect(mocks.bumpVersion).toHaveBeenCalledWith(42)
  })

  it('bumps version per SSE event and bumps missed books in finally for bulk re-extract cover', async () => {
    mocks.api.mockResolvedValue(
      makeSseStream([`data: ${JSON.stringify({ bookId: 30, updated: true })}`, `data: ${JSON.stringify({ done: true, processed: 2, updated: 1 })}`]),
    )
    mocks.bumpVersion.mockReset()

    const selectedIds = ref(new Set([30, 40]))
    const { handleBulkReExtractCover } = useBookBulkActions(selectedIds, vi.fn())

    await handleBulkReExtractCover()

    expect(mocks.bumpVersion).toHaveBeenCalledWith(30)
    expect(mocks.bumpVersion).toHaveBeenCalledWith(40)
    expect(mocks.bumpVersion.mock.calls.filter((c) => c[0] === 30).length).toBe(1)
    expect(mocks.bumpVersion.mock.calls.filter((c) => c[0] === 40).length).toBe(1)
  })

  it('reports the bulk re-extract outcome through the English source catalog', async () => {
    i18n.global.locale.value = 'en'
    mocks.api.mockResolvedValue(makeSseStream([`data: ${JSON.stringify({ done: true, processed: 2, updated: 1 })}`]))

    const { handleBulkReExtractCover } = useBookBulkActions(ref(new Set([30, 40])), vi.fn())
    await handleBulkReExtractCover()

    expect(mocks.toastSuccess).toHaveBeenCalledWith('Re-extracted 1 of 2 covers')
  })

  it('reports a failed bulk re-extract request', async () => {
    i18n.global.locale.value = 'en'
    mocks.api.mockResolvedValue({ ok: false })

    const { handleBulkReExtractCover } = useBookBulkActions(ref(new Set([30])), vi.fn())
    await handleBulkReExtractCover()

    expect(mocks.toastError).toHaveBeenCalledWith('Could not re-extract covers')
  })

  describe('handleBulkEmbedAudioCover', () => {
    const event = (value: object) => `data: ${JSON.stringify(value)}`
    const summary = (value: object) => event({ done: true, cancelled: false, skipped: 0, ...value })

    beforeEach(() => {
      i18n.global.locale.value = 'en'
      mocks.toastSuccess.mockReset()
      mocks.toastWarning.mockReset()
      mocks.toastError.mockReset()
    })

    it('posts the selection, follows progress and reports the outcome', async () => {
      mocks.api.mockResolvedValue(
        makeSseStream([
          event({ started: true, total: 2 }),
          event({ bookId: 3, status: 'success' }),
          event({ bookId: 5, status: 'skipped', reason: 'audio cover unchanged' }),
          summary({ processed: 4, succeeded: 1, failed: 0, skipped: 3 }),
        ]),
      )
      const { handleBulkEmbedAudioCover, inFlight } = useBookBulkActions(ref(new Set([3, 4, 5, 6])), vi.fn())

      const running = handleBulkEmbedAudioCover()
      expect(inFlight.value).toMatchObject({ processed: 0, total: 4 })
      await running

      expect(mocks.api).toHaveBeenCalledWith(
        '/api/v1/books/bulk-embed-audio-cover',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ bookIds: [3, 4, 5, 6] }) }),
      )
      expect(inFlight.value).toBeNull()
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Embedded the audiobook cover in 1 of 4 books')
    })

    it('counts a book as one when it is the only one', async () => {
      mocks.api.mockResolvedValue(makeSseStream([summary({ processed: 1, succeeded: 1, failed: 0 })]))

      await useBookBulkActions(ref(new Set([3])), vi.fn()).handleBulkEmbedAudioCover()

      expect(mocks.toastSuccess).toHaveBeenCalledWith('Embedded the audiobook cover in 1 of 1 book')
    })

    it('warns when some books failed', async () => {
      mocks.api.mockResolvedValue(makeSseStream([summary({ processed: 3, succeeded: 1, failed: 2 })]))

      await useBookBulkActions(ref(new Set([1, 2, 3])), vi.fn()).handleBulkEmbedAudioCover()

      expect(mocks.toastWarning).toHaveBeenCalledWith('Embedded the audiobook cover in 1 of 3 books, 2 failed')
      expect(mocks.toastSuccess).not.toHaveBeenCalled()
    })

    it('reads an event the stream splits across chunks', async () => {
      const done = summary({ processed: 2, succeeded: 2, failed: 0 })
      const encoder = new TextEncoder()
      const chunks = [encoder.encode(done.slice(0, 20)), encoder.encode(done.slice(20) + '\n')]
      let index = 0
      mocks.api.mockResolvedValue({
        ok: true,
        body: {
          getReader: () => ({ read: () => Promise.resolve(index < chunks.length ? { done: false, value: chunks[index++] } : { done: true }) }),
        },
      })

      await useBookBulkActions(ref(new Set([1, 2])), vi.fn()).handleBulkEmbedAudioCover()

      expect(mocks.toastSuccess).toHaveBeenCalledWith('Embedded the audiobook cover in 2 of 2 books')
    })

    it('reports a request the server refused', async () => {
      mocks.api.mockResolvedValue({ ok: false })
      const { handleBulkEmbedAudioCover, inFlight } = useBookBulkActions(ref(new Set([1])), vi.fn())

      await handleBulkEmbedAudioCover()

      expect(mocks.toastError).toHaveBeenCalledWith('Could not embed audiobook covers')
      expect(inFlight.value).toBeNull()
    })

    it('says a stream that ends without its summary stopped, and points to Jobs', async () => {
      mocks.api.mockResolvedValue(makeSseStream([event({ started: true, total: 1 })]))
      const { handleBulkEmbedAudioCover, inFlight } = useBookBulkActions(ref(new Set([1])), vi.fn())

      await handleBulkEmbedAudioCover()

      expect(mocks.toastError).toHaveBeenCalledWith(
        'The bulk action stopped before it finished.',
        expect.objectContaining({ action: expect.objectContaining({ label: 'Open Jobs' }) }),
      )
      expect(mocks.toastSuccess).not.toHaveBeenCalled()
      expect(inFlight.value).toBeNull()
    })

    it('does nothing without a selection', async () => {
      await useBookBulkActions(ref(new Set<number>()), vi.fn()).handleBulkEmbedAudioCover()

      expect(mocks.api).not.toHaveBeenCalled()
    })
  })

  describe('bulk runs', () => {
    beforeEach(() => {
      vi.useRealTimers()
      i18n.global.locale.value = 'en'
      mocks.toastInfo.mockReset()
      mocks.toastWarning.mockReset()
      mocks.actOnJobs.mockReset()
    })

    it('says the account already has too many bulk actions when the server answers 429', async () => {
      mocks.api.mockResolvedValue({ ok: false, status: 429 } as never)
      const { handleBulkReExtractCover, inFlight } = useBookBulkActions(ref(new Set([1, 2])), vi.fn())

      await handleBulkReExtractCover()

      expect(mocks.toastError).toHaveBeenCalledWith(
        'You already have 10 bulk actions waiting or running. Wait for one to finish, or cancel one in Jobs.',
      )
      expect(inFlight.value).toBeNull()
    })

    it('shows the run waiting until its first book lands, then counts', async () => {
      const live = liveSse()
      mocks.api.mockResolvedValue(live.response as never)
      const { handleBulkRefreshMetadata, inFlight } = useBookBulkActions(ref(new Set([1, 2])), vi.fn())

      const running = handleBulkRefreshMetadata()
      await flushStream()
      expect(inFlight.value).toMatchObject({ kind: 'book-refresh-metadata', runId: 'run-7', waiting: true, processed: 0, total: 2 })

      live.send({ bookId: 1, success: true })
      await flushStream()
      expect(inFlight.value).toMatchObject({ waiting: false, processed: 1 })

      live.send({ bookId: 2, success: false, error: 'No match' })
      live.send({ done: true, processed: 1, failed: 1 })
      live.close()
      await running

      expect(inFlight.value).toBeNull()
      expect(mocks.toastWarning).toHaveBeenCalledWith('Refreshed 1 book, 1 failed')
    })

    it('cancels through Jobs and reports how far the run got instead of its summary', async () => {
      mocks.actOnJobs.mockResolvedValue({ results: [{ id: 'bulk-run:run-7', outcome: 'done', status: 'running' }] })
      const live = liveSse()
      mocks.api.mockResolvedValue(live.response as never)
      const { handleBulkEmbedAudioCover, cancelInFlight, inFlight } = useBookBulkActions(ref(new Set([1, 2, 3])), vi.fn())

      const running = handleBulkEmbedAudioCover()
      live.send({ started: true, total: 3 })
      live.send({ bookId: 1, status: 'success' })
      await flushStream()

      await cancelInFlight()
      expect(mocks.actOnJobs).toHaveBeenCalledWith({ action: 'cancel', ids: ['bulk-run:run-7'] })
      expect(inFlight.value?.cancelling).toBe(true)

      live.send({ done: true, processed: 3, succeeded: 1, failed: 0, skipped: 0, cancelled: 2 })
      live.close()
      await running

      expect(mocks.toastInfo).toHaveBeenCalledWith('Bulk action cancelled after 1 of 3.')
      expect(mocks.toastSuccess).not.toHaveBeenCalled()
    })

    it('lets the run go on in the background when the pill is hidden', async () => {
      const live = liveSse()
      mocks.api.mockResolvedValue(live.response as never)
      const { handleBulkReExtractCover, hideInFlight, inFlight } = useBookBulkActions(ref(new Set([1, 2])), vi.fn())

      const running = handleBulkReExtractCover()
      await flushStream()
      hideInFlight()
      await running

      expect(inFlight.value).toBeNull()
      expect(mocks.toastInfo).toHaveBeenCalledWith('The bulk action keeps running in the background.', expect.anything())
      expect(mocks.toastSuccess).not.toHaveBeenCalled()
      expect(mocks.toastError).not.toHaveBeenCalled()
    })
  })

  it('bumps all re-extract IDs in finally when stream delivers no events', async () => {
    mocks.api.mockResolvedValue(makeSseStream([]))
    mocks.bumpVersion.mockReset()

    const selectedIds = ref(new Set([11, 22]))
    const { handleBulkReExtractCover } = useBookBulkActions(selectedIds, vi.fn())

    await handleBulkReExtractCover()

    expect(mocks.bumpVersion).toHaveBeenCalledWith(11)
    expect(mocks.bumpVersion).toHaveBeenCalledWith(22)
  })
})
