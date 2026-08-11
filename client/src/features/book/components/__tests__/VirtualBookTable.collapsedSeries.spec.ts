import { describe, expect, it, vi } from 'vitest'
import { computed, ref, type Ref } from 'vue'
import { mount } from '@vue/test-utils'
import type { BookCard } from '@bookorbit/types'
import VirtualBookTable from '../VirtualBookTable.vue'

const ROW_SIZE = 44

vi.mock('@tanstack/vue-virtual', () => ({
  useVirtualizer: (options: Ref<{ count: number }>) =>
    computed(() => ({
      getVirtualItems: () => Array.from({ length: options.value.count }, (_, index) => ({ index, key: index, start: index * ROW_SIZE })),
      getTotalSize: () => options.value.count * ROW_SIZE,
      scrollToIndex: () => {},
      scrollOffset: 0,
    })),
}))

vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRouter: () => ({ push: vi.fn<(to: unknown) => void>() }),
}))

vi.mock('@/features/book/composables/useActiveCustomFields', () => ({
  useActiveCustomFields: () => ({
    fields: ref([]),
    loading: ref(false),
    initialized: ref(true),
    refresh: vi.fn<() => Promise<void>>(),
  }),
}))

function makeBook(id: number, overrides: Partial<BookCard> = {}): BookCard {
  return {
    id,
    status: 'present',
    coverAspectRatio: '2/3',
    title: `Book ${id}`,
    authors: [],
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

const collapsedSeriesBook = makeBook(1, {
  seriesId: 7,
  seriesName: 'Discworld',
  collapsedSeries: { bookCount: 3, readCount: 0, coverBookIds: [1], seriesLatestAddedAt: null },
})
const plainBook = makeBook(2)

function mountTable() {
  return mount(VirtualBookTable, {
    props: {
      books: [collapsedSeriesBook, plainBook],
      sort: [{ field: 'title', dir: 'asc' }],
      viewType: 'library',
      selectionMode: true,
      isSelected: () => false,
      total: 2,
    },
    global: {
      stubs: {
        BookTableHeader: true,
        BookTableCellDispatcher: true,
        BookTableCollapsedSeriesCell: true,
        BookTableContextMenu: true,
        BookTableHeaderContextMenu: true,
        BookCoverDialog: true,
        KeyboardShortcutOverlay: true,
      },
    },
  })
}

function bodyRows(wrapper: ReturnType<typeof mountTable>) {
  return wrapper.findAll('tbody tr')
}

describe('VirtualBookTable collapsed series rows', () => {
  it('omits the row checkbox for a collapsed series while offering it for a book', () => {
    const wrapper = mountTable()
    const [seriesRow, bookRow] = bodyRows(wrapper)

    expect(seriesRow?.find('input[type="checkbox"]').exists()).toBe(false)
    expect(bookRow?.find('input[type="checkbox"]').exists()).toBe(true)
  })

  it('ignores a click on a collapsed series row', async () => {
    const wrapper = mountTable()

    await bodyRows(wrapper)[0]?.trigger('click')

    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('selects the book behind a normal row', async () => {
    const wrapper = mountTable()

    await bodyRows(wrapper)[1]?.trigger('click')

    expect(wrapper.emitted('select')?.[0]?.[0]).toBe(plainBook.id)
  })

  it('skips a collapsed series row when selecting with the keyboard', async () => {
    const wrapper = mountTable()
    const grid = wrapper.get('[tabindex="0"]')

    await grid.trigger('keydown', { key: 'ArrowDown' })
    await grid.trigger('keydown', { key: ' ' })

    expect(wrapper.emitted('select')).toBeUndefined()

    await grid.trigger('keydown', { key: 'ArrowDown' })
    await grid.trigger('keydown', { key: ' ' })

    expect(wrapper.emitted('select')?.[0]?.[0]).toBe(plainBook.id)
  })
})
