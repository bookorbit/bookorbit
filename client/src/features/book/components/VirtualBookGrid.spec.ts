import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import type { BookCard } from '@bookorbit/types'
import VirtualBookGrid from './VirtualBookGrid.vue'

const scrollToItemMock = vi.fn<(index: number) => void>()

vi.mock('vue-virtual-scroller', () => ({
  RecycleScroller: {
    name: 'RecycleScroller',
    props: ['items'],
    emits: ['update'],
    methods: {
      scrollToItem(index: number) {
        scrollToItemMock(index)
      },
    },
    template: '<div data-testid="recycle-scroller"><slot v-for="item in items" :key="item.id" :item="item" /></div>',
  },
}))

vi.mock('./BookCoverCard.vue', () => ({
  default: {
    name: 'BookCoverCard',
    props: ['book', 'selectionMode', 'selected', 'showLabel', 'coverAspectRatio'],
    emits: ['action', 'select', 'update:book'],
    template:
      '<div>' +
      '<button data-testid="book-card" :data-cover-ratio="coverAspectRatio || \'\'" @click="$emit(\'action\', \'quick-view\')">' +
      '{{ book.id }}<span v-if="showLabel" data-testid="book-card-label-slot" /></button>' +
      '<button data-testid="book-card-select" @click="$emit(\'select\', $event)">select</button>' +
      '<button data-testid="book-card-update" @click="$emit(\'update:book\', { ...book, title: \'Updated\' })">update</button>' +
      '</div>',
  },
}))

vi.mock('./CollapsedSeriesCard.vue', () => ({
  default: {
    name: 'CollapsedSeriesCard',
    props: ['book', 'showLabel'],
    template: '<div data-testid="collapsed-series-card">{{ book.id }}<span v-if="showLabel" data-testid="series-card-label-slot" /></div>',
  },
}))

const displaySettingsState = {
  gridCardPrimaryLabel: ref('hidden'),
  gridCardSecondaryLabel: ref('hidden'),
  cardInfoMode: ref('hover-overlay'),
}

vi.mock('@/composables/useDisplaySettings', () => ({
  useDisplaySettings: () => displaySettingsState,
}))

function makeBook(id: number, overrides: Partial<BookCard> = {}): BookCard {
  return {
    id,
    status: 'present',
    title: `Book ${id}`,
    authors: [],
    seriesName: null,
    seriesIndex: id,
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

describe('VirtualBookGrid', () => {
  it('uses the virtual scroller by default', () => {
    const wrapper = mount(VirtualBookGrid, {
      props: {
        books: [makeBook(1), makeBook(2)],
        coverSize: 120,
        gridGap: 12,
      },
    })

    expect(wrapper.find('[data-testid="recycle-scroller"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="book-grid-static"]').exists()).toBe(false)
  })

  it('renders every book directly when virtualization is disabled', () => {
    const books = Array.from({ length: 27 }, (_, index) => makeBook(index + 1))
    const wrapper = mount(VirtualBookGrid, {
      props: {
        books,
        coverSize: 120,
        gridGap: 12,
        virtualized: false,
      },
    })

    expect(wrapper.find('[data-testid="recycle-scroller"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="book-card"]')).toHaveLength(27)
  })

  it('keeps book actions wired in direct render mode', async () => {
    const books = [makeBook(1)]
    const wrapper = mount(VirtualBookGrid, {
      props: {
        books,
        coverSize: 120,
        gridGap: 12,
        virtualized: false,
      },
    })

    await wrapper.get('[data-testid="book-card"]').trigger('click')

    expect(wrapper.emitted('action')).toEqual([[books[0], 'quick-view']])
  })

  it('forwards select and update events in direct render mode', async () => {
    const books = [makeBook(1)]
    const wrapper = mount(VirtualBookGrid, {
      props: {
        books,
        coverSize: 120,
        gridGap: 12,
        virtualized: false,
      },
    })

    await wrapper.get('[data-testid="book-card-select"]').trigger('click')
    await wrapper.get('[data-testid="book-card-update"]').trigger('click')

    expect(wrapper.emitted('select')?.[0]?.[0]).toBe(1)
    const updateEvent = wrapper.emitted('update:book')
    expect(updateEvent).toBeDefined()
    const updatedBook = updateEvent?.[0]?.[0] as BookCard | undefined
    expect(updatedBook).toBeDefined()
    expect(updatedBook?.title).toBe('Updated')
  })

  it('forwards select and update events in virtualized mode', async () => {
    const books = [makeBook(2)]
    const wrapper = mount(VirtualBookGrid, {
      props: {
        books,
        coverSize: 120,
        gridGap: 12,
      },
    })

    await wrapper.get('[data-testid="book-card-select"]').trigger('click')
    await wrapper.get('[data-testid="book-card-update"]').trigger('click')

    expect(wrapper.emitted('select')?.[0]?.[0]).toBe(2)
    const updateEvent = wrapper.emitted('update:book')
    expect(updateEvent).toBeDefined()
    const updatedBook = updateEvent?.[0]?.[0] as BookCard | undefined
    expect(updatedBook).toBeDefined()
    expect(updatedBook?.title).toBe('Updated')
  })

  it('renders audiobook cards 1.25x wider in static mode when audioCoverScale is set', () => {
    const books = [
      makeBook(1, { files: [{ id: 11, format: 'epub', role: 'primary', sizeBytes: null }] }),
      makeBook(2, { files: [{ id: 22, format: 'MP3', role: 'primary', sizeBytes: null }] }),
    ]

    const wrapper = mount(VirtualBookGrid, {
      props: {
        books,
        coverSize: 120,
        gridGap: 12,
        virtualized: false,
        audioCoverScale: 1.25,
      },
    })

    const itemWrappers = wrapper.findAll('.min-w-0.shrink-0')
    expect(itemWrappers).toHaveLength(2)
    expect(wrapper.get('[data-testid="book-grid-static"]').classes()).toContain('content-start')
    expect(wrapper.get('[data-testid="book-grid-static"]').classes()).toContain('items-end')
    const cards = wrapper.findAll('[data-testid="book-card"]')
    expect(cards[0]!.attributes('data-cover-ratio')).toBe('2/3')
    expect(cards[1]!.attributes('data-cover-ratio')).toBe('1/1')

    const ebookWrapperStyle = itemWrappers[0]!.attributes('style')
    const audioWrapperStyle = itemWrappers[1]!.attributes('style')

    expect(ebookWrapperStyle).toContain('width: 120px;')
    expect(audioWrapperStyle).toContain('width: 150px;')
  })

  describe('windowed slots', () => {
    it('renders skeletons for placeholder slots and cards for loaded slots', () => {
      const wrapper = mount(VirtualBookGrid, {
        props: {
          books: [makeBook(1), { id: -1, placeholder: true as const }, makeBook(2)],
          coverSize: 120,
          gridGap: 12,
        },
      })

      expect(wrapper.findAll('[data-testid="book-cover-skeleton"]')).toHaveLength(1)
      expect(wrapper.findAll('[data-testid="book-card"]')).toHaveLength(2)
    })

    it('re-emits the scroller update event as a range event', async () => {
      const wrapper = mount(VirtualBookGrid, {
        props: { books: [makeBook(1)], coverSize: 120, gridGap: 12 },
      })

      wrapper.getComponent({ name: 'RecycleScroller' }).vm.$emit('update', 10, 60, 20, 50)
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('range')).toEqual([[10, 60]])
    })

    it('exposes scrollToIndex which delegates to the scroller', () => {
      const wrapper = mount(VirtualBookGrid, {
        props: { books: [makeBook(1)], coverSize: 120, gridGap: 12 },
      })

      ;(wrapper.vm as unknown as { scrollToIndex: (i: number) => void }).scrollToIndex(42)
      expect(scrollToItemMock).toHaveBeenCalledWith(42)
    })

    it('reserves a right gutter when railGutter is set', () => {
      const wrapper = mount(VirtualBookGrid, {
        props: { books: [makeBook(1)], coverSize: 120, gridGap: 12, railGutter: true },
      })

      expect(wrapper.classes()).toContain('pr-9')
    })
  })

  describe('show-label prop forwarding', () => {
    afterEach(() => {
      displaySettingsState.cardInfoMode.value = 'hover-overlay'
    })

    it('does not pass showLabel when cardInfoMode is hover-overlay', () => {
      displaySettingsState.cardInfoMode.value = 'hover-overlay'

      const wrapper = mount(VirtualBookGrid, {
        props: { books: [makeBook(1)], coverSize: 120, gridGap: 12, virtualized: false },
      })

      expect(wrapper.find('[data-testid="book-card-label-slot"]').exists()).toBe(false)
    })

    it('passes showLabel=true when cardInfoMode is below-cover', () => {
      displaySettingsState.cardInfoMode.value = 'below-cover'

      const wrapper = mount(VirtualBookGrid, {
        props: { books: [makeBook(1)], coverSize: 120, gridGap: 12, virtualized: false },
      })

      expect(wrapper.find('[data-testid="book-card-label-slot"]').exists()).toBe(true)
    })

    it('does not pass showLabel when cardInfoMode is off', () => {
      displaySettingsState.cardInfoMode.value = 'off'

      const wrapper = mount(VirtualBookGrid, {
        props: { books: [makeBook(1)], coverSize: 120, gridGap: 12, virtualized: false },
      })

      expect(wrapper.find('[data-testid="book-card-label-slot"]').exists()).toBe(false)
    })

    it('passes showLabel to CollapsedSeriesCard when cardInfoMode is below-cover', () => {
      displaySettingsState.cardInfoMode.value = 'below-cover'

      const seriesBook = makeBook(1, {
        collapsedSeries: {
          bookCount: 3,
          readCount: 0,
          coverBookIds: [],
          seriesLatestAddedAt: null,
          firstVolumeBookId: null,
          latestVolumeBookId: null,
          firstUnreadBookId: null,
        },
      })
      const wrapper = mount(VirtualBookGrid, {
        props: { books: [seriesBook], coverSize: 120, gridGap: 12, virtualized: false },
      })

      expect(wrapper.find('[data-testid="series-card-label-slot"]').exists()).toBe(true)
    })
  })
})
