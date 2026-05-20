import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookCard } from '@bookorbit/types'
import BookTableCollapsedSeriesRow from '../BookTableCollapsedSeriesRow.vue'

const mockRouterPush = vi.fn<(...args: unknown[]) => unknown>()

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockRouterPush }),
}))

function makeBook(overrides: Partial<BookCard> = {}): BookCard {
  return {
    id: 1,
    status: 'present',
    title: 'Book One',
    authors: ['Author A'],
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
    collapsedSeries: {
      bookCount: 5,
      readCount: 2,
      coverBookIds: [10, 20, 30, 40],
      seriesLatestAddedAt: null,
    },
    ...overrides,
  }
}

describe('BookTableCollapsedSeriesRow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the series name and book count', () => {
    const wrapper = mount(BookTableCollapsedSeriesRow, {
      props: { book: makeBook(), colspan: 6 },
    })

    expect(wrapper.text()).toContain('The Arc')
    expect(wrapper.text()).toContain('5 books')
  })

  it('renders the read count when some books are read', () => {
    const wrapper = mount(BookTableCollapsedSeriesRow, {
      props: { book: makeBook(), colspan: 6 },
    })

    expect(wrapper.text()).toContain('2 of 5 read')
  })

  it('does not render the read count when no books are read', () => {
    const wrapper = mount(BookTableCollapsedSeriesRow, {
      props: {
        book: makeBook({
          collapsedSeries: { bookCount: 5, readCount: 0, coverBookIds: [10, 20], seriesLatestAddedAt: null },
        }),
        colspan: 6,
      },
    })

    expect(wrapper.text()).not.toContain('0 of 5 read')
  })

  it('renders up to four cover thumbnails', () => {
    const wrapper = mount(BookTableCollapsedSeriesRow, {
      props: { book: makeBook(), colspan: 6 },
    })

    const images = wrapper.findAll('img')
    expect(images).toHaveLength(4)
    expect(images.map((image) => image.attributes('src'))).toEqual([
      '/api/v1/books/10/thumbnail',
      '/api/v1/books/20/thumbnail',
      '/api/v1/books/30/thumbnail',
      '/api/v1/books/40/thumbnail',
    ])
  })

  it('renders a placeholder when no cover ids are available', () => {
    const wrapper = mount(BookTableCollapsedSeriesRow, {
      props: {
        book: makeBook({
          collapsedSeries: { bookCount: 5, readCount: 0, coverBookIds: [], seriesLatestAddedAt: null },
        }),
        colspan: 6,
      },
    })

    expect(wrapper.findAll('img')).toHaveLength(0)
    expect(wrapper.text()).toContain('?')
  })

  it('navigates to the series detail route on click', async () => {
    const wrapper = mount(BookTableCollapsedSeriesRow, {
      props: { book: makeBook(), colspan: 6 },
    })

    await wrapper.get('td').trigger('click')

    expect(mockRouterPush).toHaveBeenCalledWith({
      name: 'series-detail',
      params: { seriesName: 'The Arc' },
    })
  })

  it('renders no more than four thumbnails even when more cover ids are provided', () => {
    const wrapper = mount(BookTableCollapsedSeriesRow, {
      props: {
        book: makeBook({
          collapsedSeries: { bookCount: 6, readCount: 1, coverBookIds: [10, 20, 30, 40, 50, 60], seriesLatestAddedAt: null },
        }),
        colspan: 6,
      },
    })

    expect(wrapper.findAll('img')).toHaveLength(4)
  })

  it('sets the expected colspan on the table cell', () => {
    const wrapper = mount(BookTableCollapsedSeriesRow, {
      props: { book: makeBook(), colspan: 9 },
    })

    expect(wrapper.get('td').attributes('colspan')).toBe('9')
  })

  it('does not navigate when selectionMode is true', async () => {
    const wrapper = mount(BookTableCollapsedSeriesRow, {
      props: { book: makeBook(), colspan: 6, selectionMode: true },
    })

    await wrapper.get('td').trigger('click')

    expect(mockRouterPush).not.toHaveBeenCalled()
  })
})
