import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { BookDuplicateGroup, BookDuplicateScan } from '@bookorbit/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createBookDuplicateScan,
  deleteDuplicateBooks,
  getActiveBookDuplicateScan,
  getBookDuplicateGroups,
  getBookDuplicateScan,
} from '../api/book-duplicates'
import { useBookDuplicates } from './useBookDuplicates'

vi.mock('../api/book-duplicates', () => ({
  createBookDuplicateScan: vi.fn<(...args: unknown[]) => unknown>(),
  deleteDuplicateBooks: vi.fn<(...args: unknown[]) => unknown>(),
  getActiveBookDuplicateScan: vi.fn<(...args: unknown[]) => unknown>(),
  getBookDuplicateGroups: vi.fn<(...args: unknown[]) => unknown>(),
  getBookDuplicateScan: vi.fn<(...args: unknown[]) => unknown>(),
}))

const runningScan: BookDuplicateScan = {
  id: 11,
  status: 'running',
  libraryIds: [2],
  requestedLibraryId: 2,
  similarityPercent: 85,
  processedBooks: 5,
  totalBooks: 10,
  progressPercent: 50,
  totalGroups: null,
  errorCode: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  completedAt: null,
}

const completedScan: BookDuplicateScan = {
  ...runningScan,
  status: 'completed',
  processedBooks: 10,
  progressPercent: 100,
  totalGroups: 0,
  completedAt: '2026-01-01T00:01:00.000Z',
}

function mountComposable() {
  let duplicates!: ReturnType<typeof useBookDuplicates>
  const wrapper = mount(
    defineComponent({
      setup() {
        duplicates = useBookDuplicates()
        return () => h('div')
      },
    }),
  )
  return { duplicates, wrapper }
}

describe('useBookDuplicates', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(createBookDuplicateScan).mockReset()
    vi.mocked(deleteDuplicateBooks).mockReset()
    vi.mocked(getActiveBookDuplicateScan).mockReset()
    vi.mocked(getBookDuplicateGroups).mockReset()
    vi.mocked(getBookDuplicateScan).mockReset()
    vi.mocked(getBookDuplicateGroups).mockResolvedValue({ groups: [], total: 0, page: 1, pageSize: 20 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps polling after a transient status error and loads completed results', async () => {
    vi.mocked(createBookDuplicateScan).mockResolvedValue(runningScan)
    vi.mocked(getBookDuplicateScan).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(completedScan)
    const { duplicates } = mountComposable()

    await duplicates.startScan(2, 85)
    await vi.advanceTimersByTimeAsync(1000)

    expect(duplicates.error.value).toBe('Could not load scan progress.')

    await vi.advanceTimersByTimeAsync(1000)

    expect(getBookDuplicateScan).toHaveBeenCalledTimes(2)
    expect(getBookDuplicateGroups).toHaveBeenCalledWith(11, { page: 1, pageSize: 20, reason: undefined })
    expect(duplicates.scan.value?.status).toBe('completed')
    expect(duplicates.error.value).toBeNull()
  })

  it('resumes an active scan after the view is reloaded', async () => {
    vi.mocked(getActiveBookDuplicateScan).mockResolvedValue(runningScan)
    const { duplicates } = mountComposable()

    await duplicates.resumeActiveScan()

    expect(duplicates.scan.value).toEqual(runningScan)
    expect(duplicates.scanning.value).toBe(true)
    expect(vi.getTimerCount()).toBe(1)
  })

  it('moves back to the last populated page when results shrink', async () => {
    vi.mocked(getBookDuplicateGroups)
      .mockResolvedValueOnce({ groups: [], total: 1, page: 2, pageSize: 20 })
      .mockResolvedValueOnce({ groups: [] as BookDuplicateGroup[], total: 1, page: 1, pageSize: 20 })
    const { duplicates } = mountComposable()
    duplicates.scan.value = completedScan
    duplicates.page.value = 2

    await duplicates.fetchGroups()

    expect(duplicates.page.value).toBe(1)
    expect(getBookDuplicateGroups).toHaveBeenNthCalledWith(2, 11, { page: 1, pageSize: 20, reason: undefined })
  })

  it('reloads server results after deleting a subset of a duplicate group', async () => {
    vi.mocked(deleteDuplicateBooks).mockResolvedValue(undefined)
    const { duplicates } = mountComposable()
    duplicates.scan.value = completedScan

    await expect(duplicates.discardBooks([2])).resolves.toBe(true)

    expect(deleteDuplicateBooks).toHaveBeenCalledWith([2])
    expect(getBookDuplicateGroups).toHaveBeenCalledWith(11, { page: 1, pageSize: 20, reason: undefined })
  })

  it('does not schedule another poll after the owner component unmounts', async () => {
    vi.mocked(createBookDuplicateScan).mockResolvedValue(runningScan)
    vi.mocked(getBookDuplicateScan).mockResolvedValue(runningScan)
    const { duplicates, wrapper } = mountComposable()

    await duplicates.startScan(2, 85)
    wrapper.unmount()
    await vi.runAllTimersAsync()
    await flushPromises()

    expect(getBookDuplicateScan).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports scan start and active-scan recovery failures', async () => {
    vi.mocked(createBookDuplicateScan).mockRejectedValue(new Error('start failed'))
    vi.mocked(getActiveBookDuplicateScan).mockRejectedValue(new Error('status failed'))
    const { duplicates } = mountComposable()

    await duplicates.startScan(undefined, 90)
    expect(duplicates.error.value).toBe('Could not start the duplicate scan.')

    await duplicates.resumeActiveScan()
    expect(duplicates.error.value).toBe('Could not load scan progress.')
  })

  it('applies filters, bounded page changes, and session-only dismissals', async () => {
    vi.mocked(getBookDuplicateGroups).mockImplementation(async (_scanId, params) => ({ groups: [], total: 60, page: params.page, pageSize: 20 }))
    const { duplicates } = mountComposable()
    duplicates.scan.value = completedScan
    duplicates.total.value = 60

    await duplicates.setReason('isbn')
    await duplicates.setPage(99)
    duplicates.hideGroup(42)

    expect(duplicates.reason.value).toBe('isbn')
    expect(duplicates.page.value).toBe(3)
    expect(getBookDuplicateGroups).toHaveBeenLastCalledWith(11, { page: 3, pageSize: 20, reason: 'isbn' })
  })

  it('keeps results available and reports an unsuccessful deletion', async () => {
    vi.mocked(deleteDuplicateBooks).mockRejectedValue(new Error('delete failed'))
    const { duplicates } = mountComposable()
    duplicates.scan.value = completedScan

    await expect(duplicates.discardBooks([2])).resolves.toBe(false)

    expect(getBookDuplicateGroups).not.toHaveBeenCalled()
    expect(duplicates.deleting.value).toBe(false)
  })
})
