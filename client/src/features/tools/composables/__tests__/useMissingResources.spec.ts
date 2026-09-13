import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import type { CoverSweep, MissingBookEntry, MissingResourcesSummary } from '@bookorbit/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/missing-resources', () => ({
  cleanBrokenCovers: vi.fn<(...args: unknown[]) => unknown>(),
  cleanMissingBooks: vi.fn<(...args: unknown[]) => unknown>(),
  cleanOrphanedCoverDirs: vi.fn<(...args: unknown[]) => unknown>(),
  getBrokenCovers: vi.fn<(...args: unknown[]) => unknown>(),
  getCoverSweep: vi.fn<(...args: unknown[]) => unknown>(),
  getMissingBooks: vi.fn<(...args: unknown[]) => unknown>(),
  getMissingResourcesSummary: vi.fn<(...args: unknown[]) => unknown>(),
  getOrphanedCoverDirs: vi.fn<(...args: unknown[]) => unknown>(),
  startCoverSweep: vi.fn<(...args: unknown[]) => unknown>(),
}))

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn<(...args: unknown[]) => void>(), error: vi.fn<(...args: unknown[]) => void>() } }))

import * as api from '../../api/missing-resources'
import { useMissingResources } from '../useMissingResources'

const runningSweep: CoverSweep = {
  status: 'running',
  processedBooks: 5,
  totalBooks: 10,
  progressPercent: 50,
  brokenCovers: 0,
  orphanedCoverDirs: 0,
  orphanedBytes: 0,
  truncated: false,
  errorCode: null,
  startedAt: '2026-08-01T00:00:00.000Z',
  completedAt: null,
}

const completedSweep: CoverSweep = {
  ...runningSweep,
  status: 'completed',
  processedBooks: 10,
  progressPercent: 100,
  brokenCovers: 2,
  orphanedCoverDirs: 1,
  orphanedBytes: 2048,
  completedAt: '2026-08-01T00:01:00.000Z',
}

function summary(overrides: Partial<MissingResourcesSummary> = {}): MissingResourcesSummary {
  return { missingBooks: 3, sweep: null, ...overrides }
}

function missingBook(id: number): MissingBookEntry {
  return {
    id,
    title: `Book ${id}`,
    authors: ['Someone'],
    libraryId: 1,
    libraryName: 'Main',
    folderPath: `/library/book-${id}`,
    formats: ['epub'],
    updatedAt: null,
  }
}

function mountComposable() {
  let resources!: ReturnType<typeof useMissingResources>
  const wrapper = mount(
    defineComponent({
      setup() {
        resources = useMissingResources()
        return () => h('div')
      },
    }),
  )
  return { resources, wrapper }
}

describe('useMissingResources', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(api.getMissingResourcesSummary).mockResolvedValue(summary())
    vi.mocked(api.getMissingBooks).mockResolvedValue({ items: [missingBook(1), missingBook(2)], total: 2, page: 1, pageSize: 50 })
    vi.mocked(api.getBrokenCovers).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 })
    vi.mocked(api.getOrphanedCoverDirs).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.resetAllMocks()
  })

  it('loads the summary and the missing books page on initialize', async () => {
    const { resources } = mountComposable()

    await resources.initialize()

    expect(resources.counts.value.missing_books).toBe(3)
    expect(resources.items.value).toHaveLength(2)
    expect(resources.total.value).toBe(2)
  })

  it('polls a running sweep until it completes, then reloads the list', async () => {
    vi.mocked(api.startCoverSweep).mockResolvedValue(runningSweep)
    vi.mocked(api.getCoverSweep).mockResolvedValueOnce(runningSweep).mockResolvedValueOnce(completedSweep)
    const { resources } = mountComposable()
    await resources.initialize()

    await resources.runSweep()
    expect(resources.sweeping.value).toBe(true)

    await vi.advanceTimersByTimeAsync(1000)
    expect(resources.sweeping.value).toBe(true)

    await vi.advanceTimersByTimeAsync(1000)

    expect(resources.sweepReady.value).toBe(true)
    expect(resources.counts.value.broken_covers).toBe(2)
    expect(resources.counts.value.orphaned_cover_dirs).toBe(1)
  })

  it('surfaces a failed sweep and stops polling', async () => {
    vi.mocked(api.startCoverSweep).mockResolvedValue(runningSweep)
    vi.mocked(api.getCoverSweep).mockResolvedValue({ ...runningSweep, status: 'failed', errorCode: 'cover_sweep_failed' })
    const { resources } = mountComposable()
    await resources.initialize()

    await resources.runSweep()
    await vi.advanceTimersByTimeAsync(1000)
    const calls = vi.mocked(api.getCoverSweep).mock.calls.length

    expect(resources.error.value).toBe('The cover check failed.')

    await vi.advanceTimersByTimeAsync(5000)
    expect(vi.mocked(api.getCoverSweep).mock.calls.length).toBe(calls)
  })

  it('does not request cover entries until a sweep has completed', async () => {
    const { resources } = mountComposable()
    await resources.initialize()

    await resources.setCategory('broken_covers')

    expect(resources.needsSweep.value).toBe(true)
    expect(api.getBrokenCovers).not.toHaveBeenCalled()
    expect(resources.items.value).toEqual([])
  })

  it('selects and deselects entries, and clears selection when switching category', async () => {
    vi.mocked(api.getMissingResourcesSummary).mockResolvedValue(summary({ sweep: completedSweep }))
    const { resources } = mountComposable()
    await resources.initialize()

    resources.toggleSelection(1)
    expect(resources.selectionCount.value).toBe(1)

    resources.togglePageSelection()
    expect(resources.allOnPageSelected.value).toBe(true)
    expect(resources.selectionCount.value).toBe(2)

    resources.toggleSelection(1)
    expect(resources.selectionCount.value).toBe(1)

    await resources.setCategory('broken_covers')
    expect(resources.selectionCount.value).toBe(0)
  })

  it('never exposes rows from the previous category while the next page is loading', async () => {
    vi.mocked(api.getMissingResourcesSummary).mockResolvedValue(summary({ sweep: completedSweep }))
    vi.mocked(api.getOrphanedCoverDirs).mockResolvedValue({
      items: [{ bookId: 1028, fileCount: 3, sizeBytes: 1024 }],
      total: 283,
      page: 1,
      pageSize: 50,
    })
    const { resources } = mountComposable()
    await resources.initialize()
    await resources.setCategory('orphaned_cover_dirs')

    let releaseMissingBooks!: () => void
    vi.mocked(api.getMissingBooks).mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseMissingBooks = () => resolve({ items: [], total: 0, page: 1, pageSize: 50 })
        }),
    )

    expect(resources.items.value).toHaveLength(1)
    expect(resources.loadedCategory.value).toBe('orphaned_cover_dirs')

    const pending = resources.setCategory('missing_books')

    // Orphan rows must not survive into a category whose rows have a different shape.
    expect(resources.category.value).toBe('missing_books')
    expect(resources.items.value).toEqual([])
    expect(resources.total.value).toBe(0)

    releaseMissingBooks()
    await pending

    expect(resources.loadedCategory.value).toBe('missing_books')
    expect(resources.total.value).toBe(0)
  })

  it('cleans the explicitly selected ids', async () => {
    vi.mocked(api.cleanMissingBooks).mockResolvedValue({ category: 'missing_books', requested: 1, cleaned: 1, skipped: 0, remaining: 1 })
    const { resources } = mountComposable()
    await resources.initialize()
    resources.toggleSelection(2)

    const done = await resources.cleanSelected()

    expect(done).toBe(true)
    expect(api.cleanMissingBooks).toHaveBeenCalledWith({ bookIds: [2] })
    expect(api.cleanMissingBooks).toHaveBeenCalledTimes(1)
    expect(resources.selectionCount.value).toBe(0)
  })

  it('repeats bounded passes until nothing matches when all is selected', async () => {
    vi.mocked(api.cleanMissingBooks)
      .mockResolvedValueOnce({ category: 'missing_books', requested: 5000, cleaned: 5000, skipped: 0, remaining: 12 })
      .mockResolvedValueOnce({ category: 'missing_books', requested: 12, cleaned: 12, skipped: 0, remaining: 0 })
    const { resources } = mountComposable()
    await resources.initialize()
    resources.selectAll()

    await resources.cleanSelected()

    expect(api.cleanMissingBooks).toHaveBeenCalledTimes(2)
    expect(api.cleanMissingBooks).toHaveBeenNthCalledWith(1, { all: true })
    expect(resources.selectAllMatching.value).toBe(false)
  })

  it('stops chaining passes when a pass cleans nothing', async () => {
    vi.mocked(api.cleanMissingBooks).mockResolvedValue({ category: 'missing_books', requested: 4, cleaned: 0, skipped: 4, remaining: 4 })
    const { resources } = mountComposable()
    await resources.initialize()
    resources.selectAll()

    await resources.cleanSelected()

    expect(api.cleanMissingBooks).toHaveBeenCalledTimes(1)
  })

  it('reports a cleanup failure without clearing the selection', async () => {
    vi.mocked(api.cleanMissingBooks).mockRejectedValue(new Error('boom'))
    const { resources } = mountComposable()
    await resources.initialize()
    resources.toggleSelection(1)

    const done = await resources.cleanSelected()

    expect(done).toBe(false)
    expect(resources.error.value).toBe('Cleanup failed.')
    expect(resources.selectionCount.value).toBe(1)
  })
})
