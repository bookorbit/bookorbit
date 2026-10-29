import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import type { ReadingHistoryItem, ReadingHistoryPage } from '@bookorbit/types'
import type { ReadingHistoryListParams } from '../api/reading-history.api'

const fetchPage = vi.fn<(params: ReadingHistoryListParams, offset: number) => Promise<ReadingHistoryPage>>()
vi.mock('../api/reading-history.api', () => ({
  fetchReadingHistoryPage: (params: ReadingHistoryListParams, offset: number) => fetchPage(params, offset),
}))

const { useReadingHistoryList } = await import('../composables/useReadingHistoryList')

function page(year: number, ids: number[]): ReadingHistoryPage {
  const items = ids.map((id) => ({ id, title: `${year}-${id}`, endedOn: `${year}-05-01` }) as ReadingHistoryItem)
  return {
    items,
    offset: 0,
    limit: 100,
    total: ids.length,
    months: [{ month: `${year}-05`, reads: ids.length, completed: ids.length, rereads: 0, pages: 0, seconds: 0 }],
  }
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function setup(initial: ReadingHistoryListParams) {
  const params = ref<ReadingHistoryListParams>(initial)
  const scope = effectScope()
  const list = scope.run(() => useReadingHistoryList(params))!
  return { params, list, stop: () => scope.stop() }
}

const base: ReadingHistoryListParams = { year: 2026, quarter: null, outcomes: ['completed'], search: '', bookId: null, sort: 'newest' }

describe('useReadingHistoryList', () => {
  beforeEach(() => {
    fetchPage.mockReset()
  })

  it('replaces the rows on a filter change instead of coming up empty', async () => {
    fetchPage.mockImplementation((params) => Promise.resolve(params.year === 2026 ? page(2026, [1, 2]) : page(2025, [3])))
    const { params, list, stop } = setup(base)
    await flush()
    expect(list.itemAt(0)?.title).toBe('2026-1')

    params.value = { ...base, year: 2025 }
    await flush()

    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(list.total.value).toBe(1)
    expect(list.itemAt(0)?.title).toBe('2025-3')
    expect(list.rows.value.map((row) => row.key)).toEqual(['m-2025-05', 'r-0'])
    stop()
  })

  it('keeps the old rows on screen while the new first page loads', async () => {
    let resolveNext: (value: ReadingHistoryPage) => void = () => {}
    fetchPage.mockResolvedValueOnce(page(2026, [1, 2])).mockImplementationOnce(() => new Promise((resolve) => (resolveNext = resolve)))
    const { params, list, stop } = setup(base)
    await flush()

    params.value = { ...base, year: 2025 }
    await flush()
    expect(list.loading.value).toBe(true)
    expect(list.itemAt(0)?.title).toBe('2026-1')

    resolveNext(page(2025, [3]))
    await flush()
    expect(list.itemAt(0)?.title).toBe('2025-3')
    stop()
  })

  it('does not refetch when the filters are rebuilt with the same values', async () => {
    fetchPage.mockResolvedValue(page(2026, [1, 2]))
    const { params, list, stop } = setup(base)
    await flush()

    params.value = { ...base, outcomes: [...base.outcomes] }
    await flush()

    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(list.itemAt(1)?.title).toBe('2026-2')
    stop()
  })

  it('drops the old rows when the new first page fails', async () => {
    fetchPage.mockResolvedValueOnce(page(2026, [1, 2])).mockRejectedValueOnce(new Error('offline'))
    const { params, list, stop } = setup(base)
    await flush()

    params.value = { ...base, year: 2025 }
    await flush()

    expect(list.error.value).toBe('offline')
    expect(list.total.value).toBe(0)
    expect(list.itemAt(0)).toBeNull()
    stop()
  })
})
