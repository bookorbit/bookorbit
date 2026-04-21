import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import type { BookCard, SeriesBooksPage } from '@bookorbit/types'

vi.mock('../api/series', () => ({
  fetchSeriesBooks: vi.fn<typeof import('../api/series').fetchSeriesBooks>(),
}))

import { fetchSeriesBooks } from '../api/series'
import { useSeriesDetail } from './useSeriesDetail'

const mockFetchSeriesBooks = vi.mocked(fetchSeriesBooks)

describe('useSeriesDetail', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('initializes with empty state', () => {
    const name = ref('Test')
    const { seriesInfo, items, total, loading, error, notFound, hasMore } = useSeriesDetail(name)

    expect(seriesInfo.value).toBeNull()
    expect(items.value).toEqual([])
    expect(total.value).toBe(0)
    expect(loading.value).toBe(false)
    expect(error.value).toBeNull()
    expect(notFound.value).toBe(false)
    expect(hasMore.value).toBe(false)
  })

  it('loads series detail and books', async () => {
    const name = ref('Dune')
    mockFetchSeriesBooks.mockResolvedValue({
      items: [{ id: 1, title: 'Dune' } as BookCard],
      total: 1,
      page: 0,
      size: 50,
      seriesInfo: { name: 'Dune', bookCount: 6, readCount: 2, authors: ['Frank Herbert'], possibleGaps: [3] },
    })

    const { seriesInfo, items, total, load } = useSeriesDetail(name)
    await load(true)

    expect(seriesInfo.value?.name).toBe('Dune')
    expect(seriesInfo.value?.possibleGaps).toEqual([3])
    expect(items.value).toHaveLength(1)
    expect(total.value).toBe(1)
  })

  it('sets notFound on 404 error', async () => {
    const name = ref('Nonexistent')
    mockFetchSeriesBooks.mockRejectedValue(new Error('404: Not Found'))

    const { notFound, error, load } = useSeriesDetail(name)
    await load(true)

    expect(notFound.value).toBe(true)
    expect(error.value).toBeNull()
  })

  it('sets error on non-404 errors', async () => {
    const name = ref('Test')
    mockFetchSeriesBooks.mockRejectedValue(new Error('500: Server Error'))

    const { notFound, error, load } = useSeriesDetail(name)
    await load(true)

    expect(notFound.value).toBe(false)
    expect(error.value).toBe('500: Server Error')
  })

  it('does not load when seriesName is empty', async () => {
    const name = ref('')
    const { load } = useSeriesDetail(name)
    await load(true)

    expect(mockFetchSeriesBooks).not.toHaveBeenCalled()
  })

  it('appends books on subsequent loads', async () => {
    const name = ref('Test')
    mockFetchSeriesBooks
      .mockResolvedValueOnce({
        items: [{ id: 1 } as BookCard],
        total: 2,
        page: 0,
        size: 50,
        seriesInfo: { name: 'Test', bookCount: 2, readCount: 0, authors: [], possibleGaps: [] },
      })
      .mockResolvedValueOnce({
        items: [{ id: 2 } as BookCard],
        total: 2,
        page: 1,
        size: 50,
        seriesInfo: { name: 'Test', bookCount: 2, readCount: 0, authors: [], possibleGaps: [] },
      })

    const { items, load } = useSeriesDetail(name)
    await load(true)
    await load()

    expect(items.value).toHaveLength(2)
  })

  it('resets notFound on fresh load', async () => {
    const name = ref('Missing')
    mockFetchSeriesBooks.mockRejectedValue(new Error('404: Not Found'))

    const { notFound, load } = useSeriesDetail(name)
    await load(true)
    expect(notFound.value).toBe(true)

    name.value = 'Found'
    mockFetchSeriesBooks.mockResolvedValue({
      items: [],
      total: 0,
      page: 0,
      size: 50,
      seriesInfo: { name: 'Found', bookCount: 0, readCount: 0, authors: [], possibleGaps: [] },
    })

    await load(true)
    expect(notFound.value).toBe(false)
  })

  it('clears seriesInfo and total on reset', async () => {
    const name = ref('Test')
    mockFetchSeriesBooks.mockResolvedValue({
      items: [{ id: 1 } as BookCard],
      total: 5,
      page: 0,
      size: 50,
      seriesInfo: { name: 'Test', bookCount: 5, readCount: 2, authors: ['Author'], possibleGaps: [] },
    })

    const { seriesInfo, total, load } = useSeriesDetail(name)
    await load(true)
    expect(seriesInfo.value?.name).toBe('Test')
    expect(total.value).toBe(5)

    let resolveLoad!: (v: SeriesBooksPage) => void
    mockFetchSeriesBooks.mockImplementation(
      () =>
        new Promise<SeriesBooksPage>((resolve) => {
          resolveLoad = resolve
        }),
    )

    const pendingLoad = load(true)
    expect(seriesInfo.value).toBeNull()
    expect(total.value).toBe(0)

    resolveLoad({
      items: [],
      total: 0,
      page: 0,
      size: 50,
      seriesInfo: { name: 'New', bookCount: 0, readCount: 0, authors: [], possibleGaps: [] },
    })
    await pendingLoad
  })

  it('keeps previous seriesInfo and total during preserve reset', async () => {
    const name = ref('Test')
    mockFetchSeriesBooks.mockResolvedValue({
      items: [{ id: 1 } as BookCard],
      total: 5,
      page: 0,
      size: 50,
      seriesInfo: { name: 'Test', bookCount: 5, readCount: 2, authors: ['Author'], possibleGaps: [] },
    })

    const { seriesInfo, total, load } = useSeriesDetail(name)
    await load(true)
    expect(seriesInfo.value?.name).toBe('Test')
    expect(total.value).toBe(5)

    let resolveLoad!: (v: SeriesBooksPage) => void
    mockFetchSeriesBooks.mockImplementation(
      () =>
        new Promise<SeriesBooksPage>((resolve) => {
          resolveLoad = resolve
        }),
    )

    const pendingLoad = load({ reset: true, keepPreviousData: true })
    expect(seriesInfo.value?.name).toBe('Test')
    expect(total.value).toBe(5)

    resolveLoad({
      items: [],
      total: 0,
      page: 0,
      size: 50,
      seriesInfo: { name: 'New', bookCount: 0, readCount: 0, authors: [], possibleGaps: [] },
    })
    await pendingLoad
  })

  it('passes sort/order/libraryId to fetch', async () => {
    const name = ref('Test')
    mockFetchSeriesBooks.mockResolvedValue({
      items: [],
      total: 0,
      page: 0,
      size: 50,
      seriesInfo: { name: 'Test', bookCount: 0, readCount: 0, authors: [], possibleGaps: [] },
    })

    const { sort, order, libraryId, load } = useSeriesDetail(name)
    sort.value = 'title'
    order.value = 'desc'
    libraryId.value = 3

    await load(true)

    expect(mockFetchSeriesBooks).toHaveBeenCalledWith('Test', {
      page: 0,
      size: 50,
      sort: 'title',
      order: 'desc',
      libraryId: 3,
    })
  })

  it('discards stale response when a reset supersedes an in-flight load', async () => {
    const name = ref('Test')
    let resolveFirst!: (v: SeriesBooksPage) => void
    let resolveSecond!: (v: SeriesBooksPage) => void
    mockFetchSeriesBooks
      .mockImplementationOnce(
        () =>
          new Promise<SeriesBooksPage>((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<SeriesBooksPage>((resolve) => {
            resolveSecond = resolve
          }),
      )

    const { items, seriesInfo, load } = useSeriesDetail(name)

    const firstLoad = load(true)
    const resetLoad = load(true)

    resolveSecond!({
      items: [{ id: 2 } as BookCard],
      total: 1,
      page: 0,
      size: 50,
      seriesInfo: { name: 'Fresh', bookCount: 1, readCount: 0, authors: [], possibleGaps: [] },
    })
    await resetLoad

    resolveFirst!({
      items: [{ id: 1 } as BookCard],
      total: 1,
      page: 0,
      size: 50,
      seriesInfo: { name: 'Stale', bookCount: 999, readCount: 0, authors: [], possibleGaps: [] },
    })
    await firstLoad

    expect(items.value).toHaveLength(1)
    expect(items.value[0]!.id).toBe(2)
    expect(seriesInfo.value?.name).toBe('Fresh')
  })

  it('discards stale error when superseded by newer request', async () => {
    const name = ref('Test')
    let resolveSecond!: (v: SeriesBooksPage) => void
    mockFetchSeriesBooks
      .mockImplementationOnce(
        () =>
          new Promise<SeriesBooksPage>((_, reject) => {
            setTimeout(() => reject(new Error('Stale error')), 10)
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<SeriesBooksPage>((resolve) => {
            resolveSecond = resolve
          }),
      )

    const { error, items, load } = useSeriesDetail(name)

    const firstLoad = load(true)
    const resetLoad = load(true)

    resolveSecond!({
      items: [{ id: 1 } as BookCard],
      total: 1,
      page: 0,
      size: 50,
      seriesInfo: { name: 'OK', bookCount: 1, readCount: 0, authors: [], possibleGaps: [] },
    })
    await resetLoad
    await firstLoad

    expect(error.value).toBeNull()
    expect(items.value[0]!.id).toBe(1)
  })
})
