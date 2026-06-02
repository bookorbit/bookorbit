import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { BookCard } from '@bookorbit/types'
import CollapsedSeriesCard from '../CollapsedSeriesCard.vue'
import { useDisplaySettings } from '@/composables/useDisplaySettings'

const mockRouterPush = vi.fn<(...args: unknown[]) => unknown>()
const { mockFetchAuthors } = vi.hoisted(() => ({
  mockFetchAuthors: vi.fn<(...args: unknown[]) => unknown>(),
}))

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return {
    ...actual,
    useRouter: () => ({ push: mockRouterPush }),
    useRoute: () => ({ fullPath: '/test-path' }),
  }
})

vi.mock('../BookCoverPlaceholder.vue', () => ({
  default: { template: '<div class="book-cover-placeholder" />' },
}))

vi.mock('@/features/author/api/author', () => ({
  fetchAuthors: mockFetchAuthors,
}))

function makeBook(overrides?: Partial<BookCard>): BookCard {
  return {
    id: 1,
    status: 'present',
    title: 'Book One',
    authors: ['Author A'],
    seriesId: 42,
    seriesName: 'The Arc',
    seriesIndex: 1,
    files: [],
    publishedYear: null,
    language: null,
    genres: [],
    tags: [],
    rating: null,
    readingProgress: null,
    readStatus: null,
    addedAt: '2024-01-01T00:00:00.000Z',
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
    collapsedSeries: {
      bookCount: 5,
      readCount: 2,
      coverBookIds: [1, 2, 3, 4],
      seriesLatestAddedAt: '2024-06-01T00:00:00.000Z',
    },
    ...overrides,
  }
}

const { bookSpineOverlay, seriesCardCoverMode, gridCardPrimaryLabel, gridCardSecondaryLabel, cardInfoMode, cardOverlays } = useDisplaySettings()

describe('CollapsedSeriesCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seriesCardCoverMode.value = 'mosaic'
    mockFetchAuthors.mockResolvedValue({ items: [] })
  })

  afterEach(() => {
    bookSpineOverlay.value = 'off'
    seriesCardCoverMode.value = 'mosaic'
    gridCardPrimaryLabel.value = 'hidden'
    gridCardSecondaryLabel.value = 'hidden'
    cardInfoMode.value = 'hover-overlay'
    cardOverlays.value = ['progress-bar', 'format', 'rating', 'read-status', 'series-position']
  })

  it('renders four cover tiles when all books are represented by covers', () => {
    const wrapper = mount(CollapsedSeriesCard, {
      props: {
        book: makeBook({
          collapsedSeries: { bookCount: 6, readCount: 0, coverBookIds: [1, 2, 3, 4, 5, 6], seriesLatestAddedAt: null },
        }),
      },
    })

    expect(wrapper.findAll('[data-testid="series-cover-tile"]')).toHaveLength(4)
    expect(wrapper.findAll('[data-testid="series-cover-fallback"]')).toHaveLength(0)
  })

  it('renders img elements for each visible cover ID', () => {
    const wrapper = mount(CollapsedSeriesCard, {
      props: { book: makeBook({ collapsedSeries: { bookCount: 4, readCount: 0, coverBookIds: [10, 20, 30, 40], seriesLatestAddedAt: null } }) },
    })

    const imgs = wrapper.findAll('img')
    expect(imgs).toHaveLength(4)
    expect(imgs[0]!.attributes('src')).toBe('/api/v1/books/10/thumbnail')
    expect(imgs[1]!.attributes('src')).toBe('/api/v1/books/20/thumbnail')
  })

  it('does not pad missing slots when fewer than four covers exist', () => {
    const wrapper = mount(CollapsedSeriesCard, {
      props: {
        book: makeBook({
          collapsedSeries: { bookCount: 1, readCount: 0, coverBookIds: [5], seriesLatestAddedAt: null },
        }),
      },
    })

    expect(wrapper.findAll('[data-testid="series-cover-tile"]')).toHaveLength(1)
    expect(wrapper.findAll('[data-testid="series-cover-fallback"]')).toHaveLength(0)
    expect(wrapper.findAll('.book-cover-placeholder')).toHaveLength(1)
  })

  it('shows a single fallback tile when coverBookIds is empty', () => {
    const wrapper = mount(CollapsedSeriesCard, {
      props: {
        book: makeBook({
          collapsedSeries: { bookCount: 3, readCount: 0, coverBookIds: [], seriesLatestAddedAt: null },
        }),
      },
    })

    expect(wrapper.findAll('[data-testid="series-cover-tile"]')).toHaveLength(0)
    expect(wrapper.findAll('[data-testid="series-cover-fallback"]')).toHaveLength(1)
    expect(wrapper.findAll('.book-cover-placeholder')).toHaveLength(1)
  })

  it('shows count badge with bookCount', () => {
    const wrapper = mount(CollapsedSeriesCard, { props: { book: makeBook() } })

    const badge = wrapper.find('[data-testid="series-count-badge"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('5')
  })

  it('shows the series name only once after removing the footer title', () => {
    const wrapper = mount(CollapsedSeriesCard, { props: { book: makeBook() } })

    const seriesNameInstances = wrapper
      .findAll('p')
      .map((node) => node.text())
      .filter((text) => text === 'The Arc')

    expect(seriesNameInstances).toHaveLength(1)
  })

  it('shows author name', () => {
    const wrapper = mount(CollapsedSeriesCard, { props: { book: makeBook() } })

    expect(wrapper.text()).toContain('Author A')
  })

  it('navigates to series detail by id on click', async () => {
    const wrapper = mount(CollapsedSeriesCard, { props: { book: makeBook() } })

    await wrapper.trigger('click')

    expect(mockRouterPush).toHaveBeenCalledWith({
      name: 'series-detail',
      params: { seriesId: 42 },
      query: { from: '/test-path' },
    })
  })

  it('uses series id even when series name has special characters', async () => {
    const wrapper = mount(CollapsedSeriesCard, {
      props: { book: makeBook({ seriesId: 43, seriesName: 'The Wheel & Time' }) },
    })

    await wrapper.trigger('click')

    expect(mockRouterPush).toHaveBeenCalledWith({
      name: 'series-detail',
      params: { seriesId: 43 },
      query: { from: '/test-path' },
    })
  })

  it('shows placeholder instead of img after @error fires', async () => {
    const wrapper = mount(CollapsedSeriesCard, {
      props: {
        book: makeBook({
          collapsedSeries: { bookCount: 2, readCount: 0, coverBookIds: [10, 20], seriesLatestAddedAt: null },
        }),
      },
    })

    const firstImg = wrapper.find('img')
    expect(firstImg.exists()).toBe(true)

    await firstImg.trigger('error')
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('.book-cover-placeholder')).toHaveLength(2)
  })

  it('uses at most 4 cover tiles even if more are provided', () => {
    const wrapper = mount(CollapsedSeriesCard, {
      props: {
        book: makeBook({
          collapsedSeries: { bookCount: 6, readCount: 0, coverBookIds: [1, 2, 3, 4, 5, 6], seriesLatestAddedAt: null },
        }),
      },
    })

    expect(wrapper.findAll('[data-testid="series-cover-tile"]')).toHaveLength(4)
    expect(wrapper.findAll('[data-testid="series-cover-fallback"]')).toHaveLength(0)
  })

  it('forces spine overlay off for audiobook series cards', () => {
    bookSpineOverlay.value = 'strong'
    const wrapper = mount(CollapsedSeriesCard, {
      props: {
        book: makeBook({
          files: [{ id: 5, format: 'm4b', role: 'primary', sizeBytes: null }],
        }),
      },
    })

    const cover = wrapper.find('.book-cover-surface')
    expect(cover.attributes('data-cover-spine')).toBe('off')
  })

  describe('single cover mode (non-mosaic)', () => {
    it('renders single cover for first-volume mode', () => {
      seriesCardCoverMode.value = 'first-volume'
      const wrapper = mount(CollapsedSeriesCard, {
        props: {
          book: makeBook({
            collapsedSeries: {
              bookCount: 5,
              readCount: 0,
              coverBookIds: [1, 2, 3, 4],
              seriesLatestAddedAt: null,
              firstVolumeBookId: 10,
              latestVolumeBookId: 40,
              firstUnreadBookId: 20,
            },
          }),
        },
      })

      expect(wrapper.find('[data-testid="series-single-cover"]').exists()).toBe(true)
      expect(wrapper.findAll('[data-testid="series-cover-tile"]')).toHaveLength(0)
      const img = wrapper.find('[data-testid="series-single-cover"] img')
      expect(img.exists()).toBe(true)
      expect(img.attributes('src')).toBe('/api/v1/books/10/thumbnail')
    })

    it('renders single cover for latest-volume mode', () => {
      seriesCardCoverMode.value = 'latest-volume'
      const wrapper = mount(CollapsedSeriesCard, {
        props: {
          book: makeBook({
            collapsedSeries: {
              bookCount: 5,
              readCount: 0,
              coverBookIds: [1, 2, 3, 4],
              seriesLatestAddedAt: null,
              firstVolumeBookId: 10,
              latestVolumeBookId: 40,
              firstUnreadBookId: 20,
            },
          }),
        },
      })

      const img = wrapper.find('[data-testid="series-single-cover"] img')
      expect(img.attributes('src')).toBe('/api/v1/books/40/thumbnail')
    })

    it('renders single cover for first-unread mode', () => {
      seriesCardCoverMode.value = 'first-unread'
      const wrapper = mount(CollapsedSeriesCard, {
        props: {
          book: makeBook({
            collapsedSeries: {
              bookCount: 5,
              readCount: 2,
              coverBookIds: [1, 2, 3, 4],
              seriesLatestAddedAt: null,
              firstVolumeBookId: 10,
              latestVolumeBookId: 40,
              firstUnreadBookId: 20,
            },
          }),
        },
      })

      const img = wrapper.find('[data-testid="series-single-cover"] img')
      expect(img.attributes('src')).toBe('/api/v1/books/20/thumbnail')
    })

    it('falls back to first coverBookId when volume ID is missing', () => {
      seriesCardCoverMode.value = 'first-volume'
      const wrapper = mount(CollapsedSeriesCard, {
        props: {
          book: makeBook({
            collapsedSeries: {
              bookCount: 3,
              readCount: 0,
              coverBookIds: [77, 88],
              seriesLatestAddedAt: null,
            },
          }),
        },
      })

      const img = wrapper.find('[data-testid="series-single-cover"] img')
      expect(img.attributes('src')).toBe('/api/v1/books/77/thumbnail')
    })

    it('first-unread falls back to firstVolumeBookId when firstUnreadBookId is missing', () => {
      seriesCardCoverMode.value = 'first-unread'
      const wrapper = mount(CollapsedSeriesCard, {
        props: {
          book: makeBook({
            collapsedSeries: {
              bookCount: 3,
              readCount: 3,
              coverBookIds: [1, 2, 3],
              seriesLatestAddedAt: null,
              firstVolumeBookId: 10,
            },
          }),
        },
      })

      const img = wrapper.find('[data-testid="series-single-cover"] img')
      expect(img.attributes('src')).toBe('/api/v1/books/10/thumbnail')
    })

    it('first-unread falls back to first coverBookId when both unread and first volume are missing', () => {
      seriesCardCoverMode.value = 'first-unread'
      const wrapper = mount(CollapsedSeriesCard, {
        props: {
          book: makeBook({
            collapsedSeries: {
              bookCount: 3,
              readCount: 3,
              coverBookIds: [77, 88],
              seriesLatestAddedAt: null,
            },
          }),
        },
      })

      const img = wrapper.find('[data-testid="series-single-cover"] img')
      expect(img.attributes('src')).toBe('/api/v1/books/77/thumbnail')
    })

    it('shows count badge in single cover mode', () => {
      seriesCardCoverMode.value = 'first-volume'
      const wrapper = mount(CollapsedSeriesCard, {
        props: {
          book: makeBook({
            collapsedSeries: {
              bookCount: 7,
              readCount: 0,
              coverBookIds: [1, 2],
              seriesLatestAddedAt: null,
              firstVolumeBookId: 1,
            },
          }),
        },
      })

      const badge = wrapper.find('[data-testid="series-count-badge"]')
      expect(badge.exists()).toBe(true)
      expect(badge.text()).toBe('7')
    })

    it('shows hover overlay with series name and author in single cover mode', () => {
      seriesCardCoverMode.value = 'latest-volume'
      const wrapper = mount(CollapsedSeriesCard, {
        props: {
          book: makeBook({
            seriesName: 'Dune Saga',
            authors: ['Frank Herbert'],
            collapsedSeries: {
              bookCount: 3,
              readCount: 0,
              coverBookIds: [1, 2, 3],
              seriesLatestAddedAt: null,
              latestVolumeBookId: 3,
            },
          }),
        },
      })

      expect(wrapper.text()).toContain('Dune Saga')
      expect(wrapper.text()).toContain('Frank Herbert')
    })

    it('shows placeholder after single cover image error', async () => {
      seriesCardCoverMode.value = 'first-volume'
      const wrapper = mount(CollapsedSeriesCard, {
        props: {
          book: makeBook({
            collapsedSeries: {
              bookCount: 2,
              readCount: 0,
              coverBookIds: [10, 20],
              seriesLatestAddedAt: null,
              firstVolumeBookId: 10,
            },
          }),
        },
      })

      const img = wrapper.find('[data-testid="series-single-cover"] img')
      expect(img.exists()).toBe(true)

      await img.trigger('error')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('[data-testid="series-single-cover"] img').exists()).toBe(false)
      expect(wrapper.find('[data-testid="series-single-cover"] .book-cover-placeholder').exists()).toBe(true)
    })

    it('renders mosaic when mode is mosaic (default)', () => {
      seriesCardCoverMode.value = 'mosaic'
      const wrapper = mount(CollapsedSeriesCard, {
        props: {
          book: makeBook({
            collapsedSeries: {
              bookCount: 4,
              readCount: 0,
              coverBookIds: [1, 2, 3, 4],
              seriesLatestAddedAt: null,
              firstVolumeBookId: 1,
              latestVolumeBookId: 4,
            },
          }),
        },
      })

      expect(wrapper.find('[data-testid="series-single-cover"]').exists()).toBe(false)
      expect(wrapper.findAll('[data-testid="series-cover-tile"]')).toHaveLength(4)
    })
  })

  describe('series type badge', () => {
    it('renders series type badge on cover', () => {
      const wrapper = mount(CollapsedSeriesCard, { props: { book: makeBook() } })

      expect(wrapper.find('[data-testid="series-type-badge"]').exists()).toBe(true)
    })
  })

  describe('hover action button', () => {
    it('renders Library action button in hover overlay', () => {
      const wrapper = mount(CollapsedSeriesCard, { props: { book: makeBook() } })

      expect(wrapper.find('[data-testid="series-hover-action"]').exists()).toBe(true)
    })

    it('hover overlay has pointer-events-none to prevent invisible clicks', () => {
      const wrapper = mount(CollapsedSeriesCard, { props: { book: makeBook() } })

      const overlay = wrapper.find('[data-testid="series-hover-action"]').element.closest('.pointer-events-none')
      expect(overlay).not.toBeNull()
    })

    it('clicking Library button navigates to series-detail', async () => {
      const wrapper = mount(CollapsedSeriesCard, { props: { book: makeBook() } })

      await wrapper.find('[data-testid="series-hover-action"]').trigger('click')

      expect(mockRouterPush).toHaveBeenCalledWith({
        name: 'series-detail',
        params: { seriesId: 42 },
        query: { from: '/test-path' },
      })
    })

    it('clicking Library button stops propagation so card handleClick does not also fire', async () => {
      const wrapper = mount(CollapsedSeriesCard, { props: { book: makeBook() } })

      await wrapper.find('[data-testid="series-hover-action"]').trigger('click')

      expect(mockRouterPush).toHaveBeenCalledTimes(1)
    })

    it('does not navigate when series id is missing', async () => {
      const wrapper = mount(CollapsedSeriesCard, { props: { book: makeBook({ seriesId: null }) } })

      await wrapper.find('[data-testid="series-hover-action"]').trigger('click')

      expect(mockRouterPush).not.toHaveBeenCalled()
    })
  })

  describe('read progress bar', () => {
    it('renders progress bar when progress-bar overlay is enabled', () => {
      cardOverlays.value = ['progress-bar']
      const wrapper = mount(CollapsedSeriesCard, { props: { book: makeBook() } })

      expect(wrapper.find('[data-testid="series-progress-bar"]').exists()).toBe(true)
    })

    it('does not render progress bar when progress-bar overlay is disabled', () => {
      cardOverlays.value = ['format', 'rating']
      const wrapper = mount(CollapsedSeriesCard, { props: { book: makeBook() } })

      expect(wrapper.find('[data-testid="series-progress-bar"]').exists()).toBe(false)
    })

    it('fill width is 0% when readCount is 0', () => {
      cardOverlays.value = ['progress-bar']
      const wrapper = mount(CollapsedSeriesCard, {
        props: { book: makeBook({ collapsedSeries: { bookCount: 5, readCount: 0, coverBookIds: [], seriesLatestAddedAt: null } }) },
      })

      const fill = wrapper.find('[data-testid="series-progress-fill"]')
      expect(fill.attributes('style')).toBe('width: 0%;')
    })

    it('fill width is 100% when all books are read', () => {
      cardOverlays.value = ['progress-bar']
      const wrapper = mount(CollapsedSeriesCard, {
        props: { book: makeBook({ collapsedSeries: { bookCount: 5, readCount: 5, coverBookIds: [], seriesLatestAddedAt: null } }) },
      })

      const fill = wrapper.find('[data-testid="series-progress-fill"]')
      expect(fill.attributes('style')).toBe('width: 100%;')
    })

    it('fill width is 40% when readCount is 2 out of 5', () => {
      cardOverlays.value = ['progress-bar']
      const wrapper = mount(CollapsedSeriesCard, {
        props: { book: makeBook({ collapsedSeries: { bookCount: 5, readCount: 2, coverBookIds: [], seriesLatestAddedAt: null } }) },
      })

      const fill = wrapper.find('[data-testid="series-progress-fill"]')
      expect(fill.attributes('style')).toBe('width: 40%;')
    })

    it('handles bookCount of 0 without crash and shows 0% width', () => {
      cardOverlays.value = ['progress-bar']
      const wrapper = mount(CollapsedSeriesCard, {
        props: { book: makeBook({ collapsedSeries: { bookCount: 0, readCount: 0, coverBookIds: [], seriesLatestAddedAt: null } }) },
      })

      const fill = wrapper.find('[data-testid="series-progress-fill"]')
      expect(fill.attributes('style')).toBe('width: 0%;')
    })

    it('clamps to 100% even if readCount exceeds bookCount', () => {
      cardOverlays.value = ['progress-bar']
      const wrapper = mount(CollapsedSeriesCard, {
        props: { book: makeBook({ collapsedSeries: { bookCount: 3, readCount: 10, coverBookIds: [], seriesLatestAddedAt: null } }) },
      })

      const fill = wrapper.find('[data-testid="series-progress-fill"]')
      expect(fill.attributes('style')).toBe('width: 100%;')
    })
  })

  describe('below-cover label buttons', () => {
    function mountWithBelowCoverLabel(overrides?: Partial<BookCard>) {
      cardInfoMode.value = 'below-cover'
      return mount(CollapsedSeriesCard, { props: { book: makeBook(overrides), showLabel: true } })
    }

    it('renders label buttons not paragraphs in below-cover mode', () => {
      gridCardPrimaryLabel.value = 'series-title'
      const wrapper = mountWithBelowCoverLabel()

      const primary = wrapper.find('[data-testid="grid-card-label-primary"]')
      expect(primary.element.tagName).toBe('BUTTON')
    })

    it('does not render label area when showLabel is false', () => {
      gridCardPrimaryLabel.value = 'series-title'
      cardInfoMode.value = 'below-cover'
      const wrapper = mount(CollapsedSeriesCard, { props: { book: makeBook(), showLabel: false } })

      expect(wrapper.find('[data-testid="grid-card-label-primary"]').exists()).toBe(false)
    })

    it('clicking series name label navigates to series-detail', async () => {
      gridCardPrimaryLabel.value = 'series-title'
      const wrapper = mountWithBelowCoverLabel()

      await wrapper.find('[data-testid="grid-card-label-primary"]').trigger('click')

      expect(mockRouterPush).toHaveBeenCalledWith({
        name: 'series-detail',
        params: { seriesId: 42 },
        query: { from: '/test-path' },
      })
    })

    it('clicking series name label stops propagation so card does not also navigate', async () => {
      gridCardPrimaryLabel.value = 'series-title'
      const wrapper = mountWithBelowCoverLabel()

      await wrapper.find('[data-testid="grid-card-label-primary"]').trigger('click')

      expect(mockRouterPush).toHaveBeenCalledTimes(1)
    })

    it('clicking author label calls fetchAuthors to resolve author', async () => {
      gridCardSecondaryLabel.value = 'author'
      const wrapper = mountWithBelowCoverLabel()

      await wrapper.find('[data-testid="grid-card-label-secondary"]').trigger('click')
      await wrapper.vm.$nextTick()

      expect(mockFetchAuthors).toHaveBeenCalledWith({
        q: 'Author A',
        page: 0,
        size: 5,
        sort: 'name',
        order: 'asc',
      })
    })

    it('clicking author label navigates to author-detail when author is found by API', async () => {
      gridCardSecondaryLabel.value = 'author'
      mockFetchAuthors.mockResolvedValue({ items: [{ id: 42, name: 'Author A' }] })
      const wrapper = mountWithBelowCoverLabel()

      await wrapper.find('[data-testid="grid-card-label-secondary"]').trigger('click')
      await wrapper.vm.$nextTick()
      await wrapper.vm.$nextTick()

      expect(mockRouterPush).toHaveBeenCalledWith({
        name: 'author-detail',
        params: { id: 42 },
        query: { from: '/test-path' },
      })
    })

    it('clicking author label navigates to authors list when author is not found by API', async () => {
      gridCardSecondaryLabel.value = 'author'
      mockFetchAuthors.mockResolvedValue({ items: [] })
      const wrapper = mountWithBelowCoverLabel()

      await wrapper.find('[data-testid="grid-card-label-secondary"]').trigger('click')
      await wrapper.vm.$nextTick()
      await wrapper.vm.$nextTick()

      expect(mockRouterPush).toHaveBeenCalledWith({
        name: 'authors',
        query: { q: 'Author A' },
      })
    })

    it('clicking author label falls back to authors list when fetchAuthors throws', async () => {
      gridCardSecondaryLabel.value = 'author'
      mockFetchAuthors.mockRejectedValue(new Error('network error'))
      const wrapper = mountWithBelowCoverLabel()

      await wrapper.find('[data-testid="grid-card-label-secondary"]').trigger('click')
      await wrapper.vm.$nextTick()
      await wrapper.vm.$nextTick()

      expect(mockRouterPush).toHaveBeenCalledWith({
        name: 'authors',
        query: { q: 'Author A' },
      })
    })

    it('does not navigate when clicking author label with no authors', async () => {
      gridCardSecondaryLabel.value = 'author'
      const wrapper = mountWithBelowCoverLabel({ authors: [] })

      const secondary = wrapper.find('[data-testid="grid-card-label-secondary"]')
      expect(secondary.exists()).toBe(false)
    })
  })
})
