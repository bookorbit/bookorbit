import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref, type Ref } from 'vue'
import type { BookCard, ScrollerType } from '@bookorbit/types'

type DashboardScrollerState = {
  books: Ref<BookCard[]>
  loading: Ref<boolean>
  error: Ref<boolean>
  refresh: () => Promise<void>
}

type UseDashboardScrollerMock = (type: ScrollerType, limit?: number, smartScopeId?: number) => DashboardScrollerState

// `sm` is true at or above the Tailwind sm breakpoint, so a false value is the
// compact viewport where the row count gets capped. A real ref keeps the mock
// reactive, so crossing the breakpoint after mount is exercised too.
const breakpoint = vi.hoisted(() => ({ sm: null as null | Ref<boolean> }))
vi.mock('@vueuse/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vueuse/core')>()
  const { ref: createRef } = await import('vue')
  breakpoint.sm = createRef(true)
  return { ...actual, useBreakpoints: () => ({ sm: breakpoint.sm }) }
})

function setCompactViewport(compact: boolean) {
  if (breakpoint.sm) breakpoint.sm.value = !compact
}

const deleteMocks = vi.hoisted(() => ({
  promptDelete: vi.fn<(id: number) => void>(),
  cancelDelete: vi.fn<() => void>(),
  confirmDelete: vi.fn<() => void>(),
}))

vi.mock('@/features/book/components/BookCoverCard.vue', () => ({
  default: {
    name: 'BookCoverCard',
    props: ['book', 'coverAspectRatio'],
    emits: ['action'],
    template: `
      <div class="book-card" :data-aspect="coverAspectRatio">
        <span>{{ book.title }}</span>
        <button class="quick-action" @click="$emit('action', 'quick-view')" />
        <button class="collection-action" @click="$emit('action', 'add-to-collection')" />
        <button class="delete-action" @click="$emit('action', 'delete')" />
      </div>
    `,
  },
}))
vi.mock('@/features/book/components/BookQuickView.vue', () => ({
  default: {
    name: 'BookQuickView',
    props: ['bookId', 'open'],
    emits: ['update:open'],
    template: `<div class="quick-view" :data-open="String(open)" :data-book-id="bookId == null ? '' : String(bookId)" />`,
  },
}))
vi.mock('@/features/collection/components/AddToCollectionSheet.vue', () => ({
  default: {
    name: 'AddToCollectionSheet',
    props: ['open', 'selectionPayload'],
    emits: ['update:open'],
    template: '<div class="collection-sheet" :data-open="String(open)" :data-book-ids="(selectionPayload.bookIds || []).join(\',\')" />',
  },
}))
vi.mock('@/features/book/components/DeleteBookDialog.vue', () => ({
  default: {
    name: 'DeleteBookDialog',
    props: ['open', 'deleting'],
    emits: ['confirm', 'cancel'],
    template: '<div class="delete-dialog" :data-open="String(open)" />',
  },
}))

vi.mock('@/features/book/composables/useDeleteBook', () => ({
  useDeleteBook: vi.fn<() => unknown>(() => ({
    pendingId: ref(null),
    deleting: ref(false),
    promptDelete: deleteMocks.promptDelete,
    cancelDelete: deleteMocks.cancelDelete,
    confirmDelete: deleteMocks.confirmDelete,
  })),
}))

vi.mock('../composables/useDashboardScroller', () => ({
  useDashboardScroller: vi.fn<UseDashboardScrollerMock>(),
}))

import DashboardScroller from './DashboardScroller.vue'
import { useDashboardScroller } from '../composables/useDashboardScroller'

const mockUseDashboardScroller = vi.mocked(useDashboardScroller)

function makeBook(id: number, format: string, coverAspectRatio: BookCard['coverAspectRatio'] = '2/3'): BookCard {
  return {
    id,
    status: 'present',
    coverAspectRatio,
    title: `Book ${id}`,
    authors: [],
    seriesName: null,
    seriesIndex: null,
    files: [{ id, format, role: 'primary', sizeBytes: 123 }],
    publishedDate: null,
    publishedYear: null,
    language: null,
    genres: [],
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
    customMetadata: [],
    tags: [],
  }
}

function mountScroller({
  type,
  books = [],
  loading = false,
  error = false,
  rows,
  limit,
  refresh = vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}: {
  type: ScrollerType
  books?: BookCard[]
  loading?: boolean
  error?: boolean
  rows?: number
  limit?: number
  refresh?: () => Promise<void>
}) {
  mockUseDashboardScroller.mockReturnValue({
    books: ref(books),
    loading: ref(loading),
    error: ref(error),
    refresh,
  })

  return mount(DashboardScroller, {
    props: {
      type,
      title: 'Shelf',
      ...(rows === undefined ? {} : { rows }),
      ...(limit === undefined ? {} : { limit }),
    },
  })
}

function bandTitles(wrapper: ReturnType<typeof mountScroller>): string[][] {
  return wrapper.findAll('[data-testid="shelf-band"]').map((band) => band.findAll('.book-card').map((card) => card.text()))
}

describe('DashboardScroller', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setCompactViewport(false)
  })

  it.each([
    ['continue-listening', 'No audiobooks in progress yet. Start listening to one to see it here.'],
    ['want-to-read', 'No books marked want to read yet.'],
  ] as const)('renders empty-state copy for %s', (type, copy) => {
    const wrapper = mountScroller({ type })

    expect(wrapper.text()).toContain(copy)
    expect(mockUseDashboardScroller).toHaveBeenCalledWith(type, 20, undefined)
  })

  it.each([
    ['continue-reading', 'No books in progress yet. Start reading one to see it here.'],
    ['up-next-in-series', 'No next-in-series picks yet. Finish a volume to surface the next one.'],
    ['recently-added', 'No books in your library yet.'],
    ['smart-scope', 'No books match this smartScope.'],
    ['random', 'No books found.'],
  ] as const)('keeps existing empty-state copy for %s', (type, copy) => {
    expect(mountScroller({ type }).text()).toContain(copy)
  })

  it('renders loading skeletons', () => {
    const wrapper = mountScroller({ type: 'continue-listening', loading: true })

    expect(wrapper.findAll('.animate-pulse')).toHaveLength(8)
    expect(wrapper.text()).not.toContain('No audiobooks in progress yet')
  })

  it('renders an error state and retries', async () => {
    const refresh = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const wrapper = mountScroller({ type: 'want-to-read', error: true, refresh })

    expect(wrapper.text()).toContain('Failed to load.')
    const retryButton = wrapper.findAll('button').find((button) => button.text().includes('Retry'))
    expect(retryButton).toBeDefined()
    await retryButton?.trigger('click')

    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('renders cover slots from library configuration instead of media format', () => {
    const wrapper = mountScroller({ type: 'continue-listening', books: [makeBook(1, 'epub', '1/1'), makeBook(2, 'm4b', '2/3')] })

    const cards = wrapper.findAll('.book-card')
    expect(wrapper.text()).toContain('2')
    expect(cards).toHaveLength(2)
    expect(cards[0]?.attributes('data-aspect')).toBe('1/1')
    expect(cards[1]?.attributes('data-aspect')).toBe('2/3')
  })

  it('keeps a mixed ebook and audiobook portrait when its library is portrait', () => {
    const mixedBook = makeBook(1, 'epub', '2/3')
    mixedBook.files.push({ id: 2, format: 'm4b', role: 'content', sizeBytes: 456 })

    const wrapper = mountScroller({ type: 'want-to-read', books: [mixedBook] })

    expect(wrapper.get('.book-card').attributes('data-aspect')).toBe('2/3')
    expect(wrapper.get('.book-card').element.parentElement?.classList.contains('w-[120px]')).toBe(true)
  })

  it('renders a single band when no row count is configured', () => {
    const wrapper = mountScroller({ type: 'recently-added', books: [makeBook(1, 'epub'), makeBook(2, 'epub'), makeBook(3, 'epub')] })

    expect(bandTitles(wrapper)).toEqual([['Book 1', 'Book 2', 'Book 3']])
  })

  it('fills bands left to right so reading order survives extra rows', () => {
    const books = Array.from({ length: 6 }, (_, index) => makeBook(index + 1, 'epub'))

    const wrapper = mountScroller({ type: 'continue-reading', books, rows: 3 })

    expect(bandTitles(wrapper)).toEqual([
      ['Book 1', 'Book 2'],
      ['Book 3', 'Book 4'],
      ['Book 5', 'Book 6'],
    ])
  })

  it('caps a three-row shelf at two bands below the sm breakpoint', () => {
    setCompactViewport(true)
    const books = Array.from({ length: 6 }, (_, index) => makeBook(index + 1, 'epub'))

    const wrapper = mountScroller({ type: 'continue-reading', books, rows: 3 })

    expect(bandTitles(wrapper)).toEqual([
      ['Book 1', 'Book 2', 'Book 3'],
      ['Book 4', 'Book 5', 'Book 6'],
    ])
  })

  it('re-flows its bands when the viewport crosses the sm breakpoint', async () => {
    const books = Array.from({ length: 6 }, (_, index) => makeBook(index + 1, 'epub'))
    const wrapper = mountScroller({ type: 'continue-reading', books, rows: 3 })

    expect(bandTitles(wrapper)).toHaveLength(3)

    setCompactViewport(true)
    await nextTick()

    expect(bandTitles(wrapper)).toEqual([
      ['Book 1', 'Book 2', 'Book 3'],
      ['Book 4', 'Book 5', 'Book 6'],
    ])
  })

  it('requests more books as rows are added', () => {
    mountScroller({ type: 'recently-added', rows: 2, limit: 20 })

    expect(mockUseDashboardScroller).toHaveBeenCalledWith('recently-added', 40, undefined)
  })

  it('never requests more books than the server accepts', () => {
    mountScroller({ type: 'recently-added', rows: 3, limit: 20 })

    expect(mockUseDashboardScroller).toHaveBeenCalledWith('recently-added', 50, undefined)
  })

  it('requests only what a capped mobile shelf can render', () => {
    setCompactViewport(true)

    mountScroller({ type: 'recently-added', rows: 3, limit: 20 })

    expect(mockUseDashboardScroller).toHaveBeenCalledWith('recently-added', 40, undefined)
  })

  it('scales loading skeletons with the row count', () => {
    const wrapper = mountScroller({ type: 'recently-added', rows: 2, loading: true })

    expect(wrapper.findAll('.animate-pulse')).toHaveLength(16)
  })

  it('opens related book actions from card events', async () => {
    const wrapper = mountScroller({ type: 'want-to-read', books: [makeBook(42, 'epub')] })

    await wrapper.find('.quick-action').trigger('click')
    expect(wrapper.find('.quick-view').attributes('data-open')).toBe('true')
    expect(wrapper.find('.quick-view').attributes('data-book-id')).toBe('42')

    await wrapper.find('.collection-action').trigger('click')
    expect(wrapper.find('.collection-sheet').attributes('data-open')).toBe('true')
    expect(wrapper.find('.collection-sheet').attributes('data-book-ids')).toBe('42')

    await wrapper.find('.delete-action').trigger('click')
    expect(deleteMocks.promptDelete).toHaveBeenCalledWith(42)
  })
})
