import { computed, onUnmounted, ref, watch } from 'vue'
import type { BulkRenamePreviewItem, BulkRenamePreviewPage, BulkRenameProgressEvent, BulkRenameStatus } from '@bookorbit/types'
import * as bulkRenameApi from '../api/bulk-rename'

export interface BulkRenameStats {
  processed: number
  succeeded: number
  failed: number
  skipped: number
}

export function useBulkRename() {
  const selectedLibraryId = ref<number | null>(null)
  const page = ref(1)
  const pageSize = ref(50)
  const statusFilter = ref<BulkRenameStatus | undefined>()

  const previewItems = ref<BulkRenamePreviewItem[]>([])
  const previewTotal = ref(0)
  const totalByStatus = ref<Record<BulkRenameStatus, number>>({
    will_rename: 0,
    unchanged: 0,
    collision: 0,
    no_pattern: 0,
    error: 0,
  })
  const totalPages = computed(() => Math.ceil(previewTotal.value / pageSize.value) || 1)

  const loading = ref(false)
  const previewError = ref<string | null>(null)

  const executing = ref(false)
  const executionStats = ref<BulkRenameStats | null>(null)
  const executionError = ref<string | null>(null)

  let abortController: AbortController | null = null

  onUnmounted(() => {
    abortController?.abort()
  })

  async function loadPreview(): Promise<void> {
    if (selectedLibraryId.value === null) return

    loading.value = true
    previewError.value = null

    try {
      const result: BulkRenamePreviewPage = await bulkRenameApi.fetchBulkRenamePreview(
        selectedLibraryId.value,
        page.value,
        pageSize.value,
        statusFilter.value,
      )
      previewItems.value = result.items
      previewTotal.value = result.total
      totalByStatus.value = result.totalByStatus
    } catch (e) {
      previewError.value = e instanceof Error ? e.message : 'Failed to load preview'
    } finally {
      loading.value = false
    }
  }

  async function execute(): Promise<void> {
    if (selectedLibraryId.value === null) return

    executing.value = true
    executionStats.value = null
    executionError.value = null

    abortController = new AbortController()

    try {
      const res = await bulkRenameApi.executeBulkRename(selectedLibraryId.value, abortController.signal)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      if (!res.body) throw new Error('No response body')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const raw = line.slice(6).trim()
            if (!raw) continue
            const event = JSON.parse(raw) as BulkRenameProgressEvent
            if ('done' in event && event.done) {
              executionStats.value = {
                processed: event.processed,
                succeeded: event.succeeded,
                failed: event.failed,
                skipped: event.skipped,
              }
            }
          }
        }
      } catch (e) {
        reader.cancel().catch(() => {})
        throw e
      }
    } catch (e) {
      if (abortController.signal.aborted) return
      executionError.value = e instanceof Error ? e.message : 'Execution failed'
    } finally {
      executing.value = false
      abortController = null
    }
  }

  function cancelExecution(): void {
    abortController?.abort()
  }

  function selectLibrary(libraryId: number): void {
    selectedLibraryId.value = libraryId
    page.value = 1
    statusFilter.value = undefined
    previewItems.value = []
    previewTotal.value = 0
    executionStats.value = null
    executionError.value = null
  }

  function setPage(newPage: number): void {
    page.value = newPage
  }

  function setStatusFilter(status: BulkRenameStatus | undefined): void {
    statusFilter.value = status
    page.value = 1
  }

  watch([page, statusFilter], () => {
    if (selectedLibraryId.value !== null) {
      loadPreview()
    }
  })

  return {
    selectedLibraryId,
    page,
    pageSize,
    statusFilter,
    totalPages,
    previewItems,
    previewTotal,
    totalByStatus,
    loading,
    previewError,
    executing,
    executionStats,
    executionError,

    selectLibrary,
    loadPreview,
    execute,
    cancelExecution,
    setPage,
    setStatusFilter,
  }
}
