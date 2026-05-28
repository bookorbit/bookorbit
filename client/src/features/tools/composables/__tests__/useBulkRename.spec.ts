import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'

vi.mock('@/lib/api', () => ({
  api: vi.fn<() => Promise<Response>>(),
}))

vi.mock('../../api/bulk-rename', () => ({
  fetchBulkRenamePreview: vi.fn<() => Promise<BulkRenamePreviewPage>>(),
  fetchBulkRenameStatus: vi.fn<() => Promise<{ running: boolean }>>(),
  executeBulkRename: vi.fn<() => Promise<Response>>(),
}))

import { useBulkRename } from '../useBulkRename'
import * as bulkRenameApi from '../../api/bulk-rename'
import type { BulkRenamePreviewPage } from '@bookorbit/types'

const mockFetchPreview = vi.mocked(bulkRenameApi.fetchBulkRenamePreview)
const mockExecute = vi.mocked(bulkRenameApi.executeBulkRename)

function makePreviewPage(overrides: Partial<BulkRenamePreviewPage> = {}): BulkRenamePreviewPage {
  return {
    items: overrides.items ?? [
      {
        bookId: 1,
        title: 'Test Book',
        currentPath: '/lib/old.epub',
        newPath: '/lib/new.epub',
        status: 'will_rename',
      },
    ],
    total: overrides.total ?? 1,
    totalByStatus: overrides.totalByStatus ?? {
      will_rename: 1,
      unchanged: 0,
      collision: 0,
      no_pattern: 0,
      error: 0,
    },
  }
}

describe('useBulkRename', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('initial state', () => {
    it('has no library selected', () => {
      const bulk = useBulkRename()
      expect(bulk.selectedLibraryId.value).toBeNull()
    })

    it('has empty preview data', () => {
      const bulk = useBulkRename()
      expect(bulk.previewItems.value).toEqual([])
      expect(bulk.previewTotal.value).toBe(0)
    })

    it('is not loading or executing', () => {
      const bulk = useBulkRename()
      expect(bulk.loading.value).toBe(false)
      expect(bulk.executing.value).toBe(false)
    })

    it('has no errors', () => {
      const bulk = useBulkRename()
      expect(bulk.previewError.value).toBeNull()
      expect(bulk.executionError.value).toBeNull()
    })
  })

  describe('selectLibrary', () => {
    it('sets the selected library id', () => {
      const bulk = useBulkRename()
      bulk.selectLibrary(5)
      expect(bulk.selectedLibraryId.value).toBe(5)
    })

    it('resets page and status filter', () => {
      const bulk = useBulkRename()
      bulk.selectLibrary(1)
      expect(bulk.page.value).toBe(1)
      expect(bulk.statusFilter.value).toBeUndefined()
    })

    it('clears previous preview data', () => {
      const bulk = useBulkRename()
      bulk.previewItems.value = [{ bookId: 1, title: 'Old', currentPath: '/a', newPath: '/b', status: 'will_rename' }]
      bulk.previewTotal.value = 1

      bulk.selectLibrary(2)
      expect(bulk.previewItems.value).toEqual([])
      expect(bulk.previewTotal.value).toBe(0)
    })

    it('clears execution state', () => {
      const bulk = useBulkRename()
      bulk.executionStats.value = { processed: 1, succeeded: 1, failed: 0, skipped: 0 }
      bulk.executionError.value = 'old error'

      bulk.selectLibrary(3)
      expect(bulk.executionStats.value).toBeNull()
      expect(bulk.executionError.value).toBeNull()
    })
  })

  describe('loadPreview', () => {
    it('fetches preview from API', async () => {
      const page = makePreviewPage()
      mockFetchPreview.mockResolvedValue(page)

      const bulk = useBulkRename()
      bulk.selectLibrary(1)
      await bulk.loadPreview()

      expect(mockFetchPreview).toHaveBeenCalledWith(1, 1, 50, undefined)
      expect(bulk.previewItems.value).toEqual(page.items)
      expect(bulk.previewTotal.value).toBe(1)
      expect(bulk.totalByStatus.value.will_rename).toBe(1)
    })

    it('does nothing when no library is selected', async () => {
      const bulk = useBulkRename()
      await bulk.loadPreview()
      expect(mockFetchPreview).not.toHaveBeenCalled()
    })

    it('sets loading state during fetch', async () => {
      let resolve: ((value: BulkRenamePreviewPage) => void) | undefined
      mockFetchPreview.mockImplementation(() => new Promise((r) => (resolve = r)))

      const bulk = useBulkRename()
      bulk.selectLibrary(1)

      const promise = bulk.loadPreview()
      expect(bulk.loading.value).toBe(true)

      resolve!(makePreviewPage())
      await promise

      expect(bulk.loading.value).toBe(false)
    })

    it('sets error on fetch failure', async () => {
      mockFetchPreview.mockRejectedValue(new Error('network error'))

      const bulk = useBulkRename()
      bulk.selectLibrary(1)
      await bulk.loadPreview()

      expect(bulk.previewError.value).toBe('network error')
    })

    it('passes status filter to API', async () => {
      mockFetchPreview.mockResolvedValue(makePreviewPage())

      const bulk = useBulkRename()
      bulk.selectLibrary(1)
      bulk.setStatusFilter('collision')
      await nextTick()
      await nextTick()

      expect(mockFetchPreview).toHaveBeenCalledWith(1, 1, 50, 'collision')
    })
  })

  describe('setPage', () => {
    it('updates the page number', () => {
      const bulk = useBulkRename()
      bulk.setPage(3)
      expect(bulk.page.value).toBe(3)
    })
  })

  describe('setStatusFilter', () => {
    it('updates the status filter and resets page', () => {
      const bulk = useBulkRename()
      bulk.setPage(3)
      bulk.setStatusFilter('will_rename')
      expect(bulk.statusFilter.value).toBe('will_rename')
      expect(bulk.page.value).toBe(1)
    })

    it('can be cleared to undefined', () => {
      const bulk = useBulkRename()
      bulk.setStatusFilter('collision')
      bulk.setStatusFilter(undefined)
      expect(bulk.statusFilter.value).toBeUndefined()
    })
  })

  describe('totalPages', () => {
    it('computes pages from total and pageSize', () => {
      const bulk = useBulkRename()
      bulk.previewTotal.value = 120

      expect(bulk.totalPages.value).toBe(3)
    })

    it('returns 1 when total is 0', () => {
      const bulk = useBulkRename()
      expect(bulk.totalPages.value).toBe(1)
    })
  })

  describe('execute', () => {
    function makeSSEResponse(events: string[]): Response {
      const encoder = new TextEncoder()
      const chunks = events.map((e) => encoder.encode(`data: ${e}\n\n`))
      let index = 0

      const readable = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (index < chunks.length) {
            controller.enqueue(chunks[index++])
          } else {
            controller.close()
          }
        },
      })

      return { ok: true, body: readable } as unknown as Response
    }

    it('streams SSE events and extracts final stats', async () => {
      const doneEvent = JSON.stringify({ done: true, processed: 5, succeeded: 3, failed: 1, skipped: 1 })
      mockExecute.mockResolvedValue(makeSSEResponse([JSON.stringify({ bookId: 1, status: 'success' }), doneEvent]))

      const bulk = useBulkRename()
      bulk.selectLibrary(1)
      await bulk.execute()

      expect(bulk.executionStats.value).toEqual({ processed: 5, succeeded: 3, failed: 1, skipped: 1 })
      expect(bulk.executing.value).toBe(false)
    })

    it('does nothing when no library is selected', async () => {
      const bulk = useBulkRename()
      await bulk.execute()
      expect(mockExecute).not.toHaveBeenCalled()
    })

    it('sets executing state during execution', async () => {
      let resolve: ((value: Response) => void) | undefined
      mockExecute.mockImplementation(() => new Promise((r) => (resolve = r)))

      const bulk = useBulkRename()
      bulk.selectLibrary(1)

      const promise = bulk.execute()
      expect(bulk.executing.value).toBe(true)

      const doneEvent = JSON.stringify({ done: true, processed: 0, succeeded: 0, failed: 0, skipped: 0 })
      const encoder = new TextEncoder()
      const readable = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${doneEvent}\n\n`))
          controller.close()
        },
      })
      resolve!({ ok: true, body: readable } as unknown as Response)
      await promise

      expect(bulk.executing.value).toBe(false)
    })

    it('sets error on HTTP failure', async () => {
      mockExecute.mockResolvedValue({ ok: false, status: 500 } as Response)

      const bulk = useBulkRename()
      bulk.selectLibrary(1)
      await bulk.execute()

      expect(bulk.executionError.value).toBe('HTTP 500')
    })

    it('sets error on missing body', async () => {
      mockExecute.mockResolvedValue({ ok: true, body: null } as unknown as Response)

      const bulk = useBulkRename()
      bulk.selectLibrary(1)
      await bulk.execute()

      expect(bulk.executionError.value).toBe('No response body')
    })
  })

  describe('cancelExecution', () => {
    it('aborts the execution without setting error', async () => {
      const abortError = new DOMException('signal is aborted', 'AbortError')
      mockExecute.mockRejectedValue(abortError)

      const bulk = useBulkRename()
      bulk.selectLibrary(1)

      const executePromise = bulk.execute()
      bulk.cancelExecution()
      await executePromise

      expect(bulk.executionError.value).toBeNull()
    })
  })
})
