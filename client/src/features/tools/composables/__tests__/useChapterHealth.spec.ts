import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import type { ChapterHealthBook, ChapterHealthPage, ChapterHealthSummary, ChapterLookupQueueState } from '@bookorbit/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/chapter-health', () => ({
  cancelChapterLookups: vi.fn<(...args: unknown[]) => unknown>(),
  clearFinishedChapterLookups: vi.fn<(...args: unknown[]) => unknown>(),
  dismissChapterReview: vi.fn<(...args: unknown[]) => unknown>(),
  enqueueChapterLookups: vi.fn<(...args: unknown[]) => unknown>(),
  getChapterHealthBooks: vi.fn<(...args: unknown[]) => unknown>(),
  getChapterHealthSummary: vi.fn<(...args: unknown[]) => unknown>(),
  getChapterLookupState: vi.fn<(...args: unknown[]) => unknown>(),
}))

import { setI18nLocale } from '@/i18n'
import { ApiError } from '@/lib/api-json'
import * as api from '../../api/chapter-health'
import { useChapterHealth } from '../useChapterHealth'

const summary: ChapterHealthSummary = {
  counts: { no_chapters: 3, one_per_file: 2, numbered_tracks: 1, needs_review: 1, edited: 4 },
  withAsin: { no_chapters: 2, one_per_file: 1, numbered_tracks: 0, needs_review: 1, edited: 0 },
}

const idle: ChapterLookupQueueState = { queued: 0, processing: null, finished: { applied: 0, review: 0, not_found: 0, failed: 0, skipped: 0 } }
const busy: ChapterLookupQueueState = { ...idle, queued: 2, processing: { bookId: 9, title: 'Dune' } }

function book(bookId: number, overrides: Partial<ChapterHealthBook> = {}): ChapterHealthBook {
  return {
    bookId,
    title: `Book ${bookId}`,
    authors: ['Someone'],
    libraryName: 'Audiobooks',
    audioFiles: 1,
    chapterCount: 0,
    source: null,
    audibleId: `B00000000${bookId}`,
    review: null,
    ...overrides,
  }
}

function page(items: ChapterHealthBook[], total = items.length): ChapterHealthPage {
  return { items, total }
}

function mountComposable() {
  let health!: ReturnType<typeof useChapterHealth>
  const wrapper = mount(
    defineComponent({
      setup() {
        health = useChapterHealth()
        return () => h('div')
      },
    }),
  )
  return { health, wrapper }
}

describe('useChapterHealth', () => {
  beforeEach(async () => {
    await setI18nLocale('en')
    vi.useFakeTimers()
    vi.mocked(api.getChapterHealthSummary).mockResolvedValue(summary)
    vi.mocked(api.getChapterHealthBooks).mockResolvedValue(page([book(1), book(2)]))
    vi.mocked(api.getChapterLookupState).mockResolvedValue(idle)
    vi.mocked(api.enqueueChapterLookups).mockResolvedValue({ queued: 2, skipped: 0 })
    vi.mocked(api.dismissChapterReview).mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.resetAllMocks()
  })

  it('loads the counts, the first page of the category and the lookup state', async () => {
    const { health } = mountComposable()

    await health.refresh()

    expect(api.getChapterHealthSummary).toHaveBeenCalledWith(null)
    expect(api.getChapterHealthBooks).toHaveBeenCalledWith({ category: 'no_chapters', libraryId: null, page: 1, pageSize: 50 })
    expect(api.getChapterLookupState).toHaveBeenCalledTimes(1)
    expect(health.summary.value).toEqual(summary)
    expect(health.items.value.map((item) => item.bookId)).toEqual([1, 2])
    expect(health.total.value).toBe(2)
    expect(health.lookup.value).toEqual(idle)
    expect(health.lookupActive.value).toBe(false)
    expect(health.lookupCandidates.value).toBe(2)
    expect(health.loadingList.value).toBe(false)
    expect(health.error.value).toBeNull()
  })

  it('reports a failed load in the tool wording', async () => {
    vi.mocked(api.getChapterHealthSummary).mockRejectedValue(new ApiError('Server said no', 500, null, 'Server said no'))
    const { health } = mountComposable()

    await health.refresh()

    expect(health.error.value).toBe('Chapter health could not be loaded.')
  })

  it('starts a new category on its first page with nothing selected', async () => {
    vi.mocked(api.getChapterHealthBooks).mockResolvedValue(page([book(1), book(2)], 120))
    const { health } = mountComposable()
    await health.refresh()
    await health.setPage(2)
    health.toggle(1)

    await health.setCategory('needs_review')

    expect(health.category.value).toBe('needs_review')
    expect(health.page.value).toBe(1)
    expect(health.selected.value.size).toBe(0)
    expect(api.getChapterHealthBooks).toHaveBeenLastCalledWith({ category: 'needs_review', libraryId: null, page: 1, pageSize: 50 })
    expect(health.lookupCandidates.value).toBe(1)
  })

  it.each([
    ['no_chapters', true],
    ['one_per_file', true],
    ['numbered_tracks', true],
    ['needs_review', false],
    ['edited', false],
  ] as const)('offers a lookup for %s: %s', async (category, expected) => {
    const { health } = mountComposable()

    await health.setCategory(category)

    expect(health.canLookUp.value).toBe(expected)
  })

  it('reloads everything for a new library on its first page with nothing selected', async () => {
    vi.mocked(api.getChapterHealthBooks).mockResolvedValue(page([book(1), book(2)], 120))
    const { health } = mountComposable()
    await health.refresh()
    await health.setPage(3)
    health.toggle(2)

    await health.setLibrary(4)

    expect(health.libraryId.value).toBe(4)
    expect(health.page.value).toBe(1)
    expect(health.selected.value.size).toBe(0)
    expect(api.getChapterHealthSummary).toHaveBeenLastCalledWith(4)
    expect(api.getChapterHealthBooks).toHaveBeenLastCalledWith({ category: 'no_chapters', libraryId: 4, page: 1, pageSize: 50 })
    expect(api.getChapterLookupState).toHaveBeenCalledTimes(2)
  })

  it('keeps the page inside the result', async () => {
    vi.mocked(api.getChapterHealthBooks).mockResolvedValue(page([book(1)], 120))
    const { health } = mountComposable()
    await health.refresh()

    await health.setPage(10)
    expect(health.page.value).toBe(3)

    await health.setPage(0)
    expect(health.page.value).toBe(1)
  })

  it('shows only the newest list when answers arrive out of order', async () => {
    let releaseFirst!: (value: ChapterHealthPage) => void
    vi.mocked(api.getChapterHealthBooks)
      .mockImplementationOnce(() => new Promise((resolve) => (releaseFirst = resolve)))
      .mockResolvedValueOnce(page([book(7)]))
    const { health } = mountComposable()

    const first = health.setCategory('one_per_file')
    await health.setCategory('numbered_tracks')
    releaseFirst(page([book(1), book(2)]))
    await first

    expect(health.items.value.map((item) => item.bookId)).toEqual([7])
    expect(health.loadingList.value).toBe(false)
  })

  it('reloads the last remaining page when the current page shrinks away', async () => {
    vi.mocked(api.getChapterHealthBooks)
      .mockResolvedValueOnce(page([book(1)], 120))
      .mockResolvedValueOnce(page([], 51))
      .mockResolvedValueOnce(page([book(51)], 51))
    const { health } = mountComposable()
    await health.refresh()
    await health.setPage(3)
    expect(health.page.value).toBe(2)
    expect(health.items.value.map((item) => item.bookId)).toEqual([51])
    expect(api.getChapterHealthBooks).toHaveBeenLastCalledWith({ category: 'no_chapters', libraryId: null, page: 2, pageSize: 50 })
  })

  it('ignores a stale summary from a previous library', async () => {
    let release!: (value: ChapterHealthSummary) => void
    vi.mocked(api.getChapterHealthSummary)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve
          }),
      )
      .mockResolvedValueOnce({ ...summary, counts: { ...summary.counts, no_chapters: 50 } })
    const { health } = mountComposable()
    const first = health.refresh()
    await health.setLibrary(4)
    release(summary)
    await first
    expect(health.summary.value?.counts.no_chapters).toBe(50)
  })

  it('ignores an old summary failure after a different library loads successfully', async () => {
    let reject!: (reason: Error) => void
    vi.mocked(api.getChapterHealthSummary)
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, fail) => {
            reject = fail
          }),
      )
      .mockResolvedValueOnce(summary)
    const { health } = mountComposable()
    const first = health.refresh()
    await health.setLibrary(4)
    reject(new Error('Old library is offline'))
    await first
    expect(health.error.value).toBeNull()
    expect(health.summary.value).toEqual(summary)
  })

  it('does not restart polling when an in-flight state request returns after stop', async () => {
    let release!: (value: ChapterLookupQueueState) => void
    vi.mocked(api.getChapterLookupState).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const { health } = mountComposable()
    const refreshing = health.refresh()
    health.stop()
    release(busy)
    await refreshing
    await vi.advanceTimersByTimeAsync(9000)
    expect(api.getChapterLookupState).toHaveBeenCalledTimes(1)
    expect(health.lookup.value).toBeNull()
  })

  it('toggles books in and out of the selection', () => {
    const { health } = mountComposable()

    health.toggle(4)
    health.toggle(7)
    health.toggle(4)

    expect([...health.selected.value]).toEqual([7])

    health.clearSelection()
    expect(health.selected.value.size).toBe(0)
  })

  it('looks up the selected books and clears the selection', async () => {
    const { health } = mountComposable()
    await health.refresh()
    health.toggle(4)
    health.toggle(7)

    const result = await health.lookUp()

    expect(api.enqueueChapterLookups).toHaveBeenCalledWith({ bookIds: [4, 7] })
    expect(result).toEqual({ queued: 2, skipped: 0 })
    expect(health.selected.value.size).toBe(0)
    expect(api.getChapterLookupState).toHaveBeenCalledTimes(2)
  })

  it('looks up the whole category when nothing is selected', async () => {
    const { health } = mountComposable()
    await health.setCategory('one_per_file')

    await health.lookUp()

    expect(api.enqueueChapterLookups).toHaveBeenCalledWith({ category: 'one_per_file' })
  })

  it('limits a category lookup to the chosen library', async () => {
    const { health } = mountComposable()
    await health.setLibrary(3)

    await health.lookUp()

    expect(api.enqueueChapterLookups).toHaveBeenCalledWith({ category: 'no_chapters', libraryId: 3 })
  })

  it('polls every 3 s while lookups wait or run, then reloads the counts and the list once', async () => {
    vi.mocked(api.getChapterLookupState).mockResolvedValueOnce(busy).mockResolvedValueOnce(busy).mockResolvedValue(idle)
    const { health } = mountComposable()
    await health.refresh()

    expect(health.lookupActive.value).toBe(true)
    expect(api.getChapterHealthSummary).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(2_999)
    expect(api.getChapterLookupState).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(api.getChapterLookupState).toHaveBeenCalledTimes(2)
    expect(api.getChapterHealthSummary).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(3_000)
    expect(api.getChapterLookupState).toHaveBeenCalledTimes(3)
    expect(health.lookupActive.value).toBe(false)
    expect(api.getChapterHealthSummary).toHaveBeenCalledTimes(2)
    expect(api.getChapterHealthBooks).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(9_000)
    expect(api.getChapterLookupState).toHaveBeenCalledTimes(3)
    expect(api.getChapterHealthSummary).toHaveBeenCalledTimes(2)
  })

  it('starts polling once a lookup is queued', async () => {
    const { health } = mountComposable()
    await health.refresh()
    vi.mocked(api.getChapterLookupState).mockResolvedValueOnce(busy).mockResolvedValue(idle)

    await health.lookUp()
    expect(health.lookupActive.value).toBe(true)

    await vi.advanceTimersByTimeAsync(3_000)
    expect(api.getChapterLookupState).toHaveBeenCalledTimes(3)
    expect(api.getChapterHealthSummary).toHaveBeenCalledTimes(2)
  })

  it('keeps polling through a failed poll', async () => {
    vi.mocked(api.getChapterLookupState)
      .mockResolvedValueOnce(busy)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(busy)
      .mockResolvedValue(idle)
    const { health } = mountComposable()
    await health.refresh()

    await vi.advanceTimersByTimeAsync(3_000)
    await vi.advanceTimersByTimeAsync(3_000)
    await vi.advanceTimersByTimeAsync(3_000)

    expect(api.getChapterLookupState).toHaveBeenCalledTimes(4)
    expect(health.lookupActive.value).toBe(false)
  })

  it('stops polling when unmounted', async () => {
    vi.mocked(api.getChapterLookupState).mockResolvedValue(busy)
    const { health, wrapper } = mountComposable()
    await health.refresh()

    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(9_000)

    expect(api.getChapterLookupState).toHaveBeenCalledTimes(1)
  })

  it('dismisses a review and reloads the counts, the list and the state', async () => {
    const { health } = mountComposable()
    await health.setCategory('needs_review')
    vi.mocked(api.getChapterHealthBooks).mockClear()

    await health.dismiss(5)

    expect(api.dismissChapterReview).toHaveBeenCalledWith(5)
    expect(api.getChapterHealthSummary).toHaveBeenCalledTimes(1)
    expect(api.getChapterHealthBooks).toHaveBeenCalledWith({ category: 'needs_review', libraryId: null, page: 1, pageSize: 50 })
    expect(api.getChapterLookupState).toHaveBeenCalledTimes(1)
  })

  it('cancels waiting lookups and clears finished ones, reloading the state each time', async () => {
    vi.mocked(api.cancelChapterLookups).mockResolvedValue({ removed: 2 })
    vi.mocked(api.clearFinishedChapterLookups).mockResolvedValue({ removed: 5 })
    const { health } = mountComposable()

    await health.cancel()
    await health.clearFinished()

    expect(api.cancelChapterLookups).toHaveBeenCalledTimes(1)
    expect(api.clearFinishedChapterLookups).toHaveBeenCalledTimes(1)
    expect(api.getChapterLookupState).toHaveBeenCalledTimes(2)
  })
})
