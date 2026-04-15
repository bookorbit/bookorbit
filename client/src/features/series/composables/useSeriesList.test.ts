import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SeriesPage } from '@projectx/types'

vi.mock('../api/series', () => ({
  fetchSeries: vi.fn<typeof import('../api/series').fetchSeries>(),
}))

import { fetchSeries } from '../api/series'
import { useSeriesList } from './useSeriesList'

const mockFetchSeries = vi.mocked(fetchSeries)

describe('useSeriesList', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('initializes with empty state', () => {
    const { items, total, loading, error, hasMore, q, sort, order } = useSeriesList()

    expect(items.value).toEqual([])
    expect(total.value).toBe(0)
    expect(loading.value).toBe(false)
    expect(error.value).toBeNull()
    expect(hasMore.value).toBe(false)
    expect(q.value).toBe('')
    expect(sort.value).toBe('name')
    expect(order.value).toBe('asc')
  })

  it('loads first page and populates items', async () => {
    mockFetchSeries.mockResolvedValue({
      items: [{ name: 'Harry Potter', bookCount: 7, readCount: 3, authors: ['J.K. Rowling'], coverBookIds: [1], lastAddedAt: null }],
      total: 1,
      page: 0,
      size: 50,
    })

    const { items, total, loading, load } = useSeriesList()
    await load(true)

    expect(loading.value).toBe(false)
    expect(items.value).toHaveLength(1)
    expect(items.value[0]!.name).toBe('Harry Potter')
    expect(total.value).toBe(1)
    expect(mockFetchSeries).toHaveBeenCalledTimes(1)
  })

  it('appends items on subsequent loads', async () => {
    mockFetchSeries
      .mockResolvedValueOnce({
        items: [{ name: 'Series A', bookCount: 3, readCount: 0, authors: [], coverBookIds: [], lastAddedAt: null }],
        total: 2,
        page: 0,
        size: 50,
      })
      .mockResolvedValueOnce({
        items: [{ name: 'Series B', bookCount: 5, readCount: 1, authors: [], coverBookIds: [], lastAddedAt: null }],
        total: 2,
        page: 1,
        size: 50,
      })

    const { items, load } = useSeriesList()
    await load(true)
    await load()

    expect(items.value).toHaveLength(2)
    expect(items.value[0]!.name).toBe('Series A')
    expect(items.value[1]!.name).toBe('Series B')
  })

  it('resets state on load(true)', async () => {
    mockFetchSeries.mockResolvedValue({
      items: [{ name: 'Series A', bookCount: 1, readCount: 0, authors: [], coverBookIds: [], lastAddedAt: null }],
      total: 1,
      page: 0,
      size: 50,
    })

    const { items, load } = useSeriesList()
    await load(true)
    expect(items.value).toHaveLength(1)

    mockFetchSeries.mockResolvedValue({
      items: [{ name: 'Series B', bookCount: 2, readCount: 0, authors: [], coverBookIds: [], lastAddedAt: null }],
      total: 1,
      page: 0,
      size: 50,
    })

    await load(true)
    expect(items.value).toHaveLength(1)
    expect(items.value[0]!.name).toBe('Series B')
  })

  it('sets error on fetch failure', async () => {
    mockFetchSeries.mockRejectedValue(new Error('Network error'))

    const { error, load } = useSeriesList()
    await load(true)

    expect(error.value).toBe('Network error')
  })

  it('sets generic error for non-Error rejections', async () => {
    mockFetchSeries.mockRejectedValue('unknown')

    const { error, load } = useSeriesList()
    await load(true)

    expect(error.value).toBe('Failed to load series')
  })

  it('does not load when already loading', async () => {
    let resolveFn!: (v: SeriesPage) => void
    mockFetchSeries.mockImplementation(
      () =>
        new Promise<SeriesPage>((resolve) => {
          resolveFn = resolve
        }),
    )

    const { loading, load } = useSeriesList()

    const firstLoad = load(true)
    expect(loading.value).toBe(true)

    const secondLoad = load(true)

    resolveFn!({ items: [], total: 0, page: 0, size: 50 })
    await firstLoad
    await secondLoad

    expect(mockFetchSeries).toHaveBeenCalledTimes(1)
  })

  it('does not load more when no more items', async () => {
    mockFetchSeries.mockResolvedValue({
      items: [{ name: 'Only One', bookCount: 1, readCount: 0, authors: [], coverBookIds: [], lastAddedAt: null }],
      total: 1,
      page: 0,
      size: 50,
    })

    const { load, hasMore } = useSeriesList()
    await load(true)
    expect(hasMore.value).toBe(false)

    await load()
    expect(mockFetchSeries).toHaveBeenCalledTimes(1)
  })

  it('passes query params to fetchSeries', async () => {
    mockFetchSeries.mockResolvedValue({ items: [], total: 0, page: 0, size: 50 })

    const { q, sort, order, libraryId, completionStatus, author, load } = useSeriesList()
    q.value = 'harry'
    sort.value = 'bookCount'
    order.value = 'desc'
    libraryId.value = 5
    completionStatus.value = 'complete'
    author.value = 'Rowling'

    await load(true)

    expect(mockFetchSeries).toHaveBeenCalledWith({
      q: 'harry',
      page: 0,
      size: 50,
      sort: 'bookCount',
      order: 'desc',
      libraryId: 5,
      completionStatus: 'complete',
      author: 'Rowling',
    })
  })

  it('trims whitespace-only query to undefined', async () => {
    mockFetchSeries.mockResolvedValue({ items: [], total: 0, page: 0, size: 50 })

    const { q, load } = useSeriesList()
    q.value = '   '
    await load(true)

    expect(mockFetchSeries).toHaveBeenCalledWith(expect.objectContaining({ q: undefined }))
  })
})
