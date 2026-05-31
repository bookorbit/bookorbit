import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import type { BookCard } from '@bookorbit/types'
import VirtualBookGrid from './VirtualBookGrid.vue'

vi.mock('vue-virtual-scroller', () => ({
  RecycleScroller: {
    name: 'RecycleScroller',
    props: ['items'],
    template: '<div data-testid="recycle-scroller"><slot v-for="item in items" :key="item.id" :item="item" /></div>',
  },
}))

vi.mock('./BookCoverCard.vue', () => ({
  default: {
    name: 'BookCoverCard',
    props: ['book', 'selectionMode', 'selected', 'showLabel'],
    emits: ['action', 'select', 'update:book'],
    template:
      '<button data-testid="book-card" @click="$emit(\'action\', \'quick-view\')">{{ book.id }}<span v-if="showLabel" data-testid="book-card-label-slot" /></button>',
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
