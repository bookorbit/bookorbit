import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaxonomyPage, TaxonomySummary } from '@bookorbit/types'
import { TAXONOMY_TOP_COUNT, useTaxonomyList } from './useTaxonomyList'

const mocks = vi.hoisted(() => ({ fetchTaxonomyPage: vi.fn<(...args: unknown[]) => Promise<TaxonomyPage>>() }))

vi.mock('../api/taxonomy', () => ({ fetchTaxonomyPage: mocks.fetchTaxonomyPage }))

function summary(id: number, bookCount = 1): TaxonomySummary {
  return { id, name: `Genre ${id}`, bookCount, readCount: 0, readingCount: 0, libraryCount: 1, lastAddedAt: null, coverBookIds: [] }
}

function pageOf(ids: number[], total: number): TaxonomyPage {
  return { items: ids.map((id) => summary(id)), total, page: 0, size: 50, totals: { genre: total, tag: 3 } }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('useTaxonomyList', () => {
  beforeEach(() => {
    mocks.fetchTaxonomyPage.mockReset()
  })

  it('loads the first page with the current search, sort and library', async () => {
    mocks.fetchTaxonomyPage.mockResolvedValue(pageOf([1, 2], 2))
    const list = useTaxonomyList('genre')
    list.q.value = '  fan '
    list.sort.value = 'name'
    list.order.value = 'asc'
    list.libraryId.value = 7

    await list.load(true)

    expect(mocks.fetchTaxonomyPage).toHaveBeenCalledWith('genre', { q: 'fan', page: 0, size: 50, sort: 'name', order: 'asc', libraryId: 7 })
    expect(list.items.value.map((item) => item.id)).toEqual([1, 2])
    expect(list.total.value).toBe(2)
    expect(list.totals.value).toEqual({ genre: 2, tag: 3 })
    expect(list.hasMore.value).toBe(false)
  })

  it('appends the next page and stops once everything is loaded', async () => {
    mocks.fetchTaxonomyPage.mockResolvedValueOnce(pageOf([1, 2], 3)).mockResolvedValueOnce(pageOf([3], 3))
    const list = useTaxonomyList('tag')

    await list.load(true)
    expect(list.hasMore.value).toBe(true)
    await list.load()

    expect(mocks.fetchTaxonomyPage).toHaveBeenLastCalledWith('tag', expect.objectContaining({ page: 1 }))
    expect(list.items.value.map((item) => item.id)).toEqual([1, 2, 3])

    await list.load()
    expect(mocks.fetchTaxonomyPage).toHaveBeenCalledTimes(2)
  })

  it('drops an answer that a newer reset has overtaken', async () => {
    const slow = deferred<TaxonomyPage>()
    mocks.fetchTaxonomyPage.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(pageOf([9], 1))
    const list = useTaxonomyList('genre')

    const first = list.load(true)
    list.q.value = 'horror'
    await list.load(true)
    slow.resolve(pageOf([1, 2, 3], 3))
    await first

    expect(list.items.value.map((item) => item.id)).toEqual([9])
    expect(list.loading.value).toBe(false)
  })

  it('keeps what it has and reports a failed page', async () => {
    mocks.fetchTaxonomyPage.mockResolvedValueOnce(pageOf([1], 2)).mockRejectedValueOnce(new Error('offline'))
    const list = useTaxonomyList('genre')

    await list.load(true)
    await list.load()

    expect(list.items.value.map((item) => item.id)).toEqual([1])
    expect(list.error.value).toBe('offline')
    expect(list.loading.value).toBe(false)
  })

  it('loads the biggest names for the cloud whatever the list is sorted by', async () => {
    mocks.fetchTaxonomyPage.mockResolvedValue({ ...pageOf([], 0), items: [summary(4, 40), summary(5, 12)] })
    const list = useTaxonomyList('genre')
    list.sort.value = 'name'
    list.q.value = 'ignored'
    list.libraryId.value = 2

    await list.loadTop()

    expect(mocks.fetchTaxonomyPage).toHaveBeenCalledWith('genre', {
      page: 0,
      size: TAXONOMY_TOP_COUNT,
      sort: 'bookCount',
      order: 'desc',
      libraryId: 2,
    })
    expect(list.top.value).toEqual([
      { id: 4, name: 'Genre 4', bookCount: 40 },
      { id: 5, name: 'Genre 5', bookCount: 12 },
    ])
  })
})
