import { computed, onUnmounted, ref } from 'vue'
import type { BulkRenameExecuteRequest, BulkRenamePreviewItem, BulkRenameProgressEvent, BulkRenameStatus } from '@bookorbit/types'

import * as bulkRenameApi from '../api/bulk-rename'

export interface BulkRenameStats {
  processed: number
  succeeded: number
  failed: number
  skipped: number
}

/**
 * Why a run failed on the client side, as a stable code rather than a message. The UI owns the
 * wording so it can be translated; nothing here is ever shown to a user directly.
 */
export interface BulkRenameFailure {
  code: 'http' | 'noBody' | 'incomplete' | 'unknown'
  status?: number
}

export type BulkRenameScope = 'changes' | 'collision' | 'unchanged' | 'all'

/** Rail pages are large enough to fill several screens and small enough to stay cheap. */
export const BULK_RENAME_PAGE_SIZE = 200

/** Long enough that typing a title does not re-page the library on every keystroke. */
export const SEARCH_DEBOUNCE_MS = 250

const SCOPE_STATUS: Record<BulkRenameScope, BulkRenameStatus | undefined> = {
  changes: 'will_rename',
  collision: 'collision',
  unchanged: 'unchanged',
  all: undefined,
}

const EMPTY_COUNTS: Record<BulkRenameStatus, number> = {
  will_rename: 0,
  unchanged: 0,
  collision: 0,
  no_pattern: 0,
  error: 0,
}

/** Carries a {@link BulkRenameFailure} through the stream reader without stringifying it. */
class BulkRenameStreamError extends Error {
  constructor(readonly failure: BulkRenameFailure) {
    super(failure.code)
    this.name = 'BulkRenameStreamError'
  }
}

function toFailure(error: unknown): BulkRenameFailure {
  if (error instanceof BulkRenameStreamError) return error.failure
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === 'number' ? { code: 'http', status } : { code: 'unknown' }
}

/**
 * Loads the rename queue for one library.
 *
 * The queue is paged rather than fetched whole: a first run on a large library can put tens of
 * thousands of books in the `will_rename` bucket, and the rail only renders what has been
 * loaded. Counts always come from the server's totals, so the header stays accurate while the
 * list is still filling.
 */
export function useBulkRename() {
  const selectedLibraryId = ref<number | null>(null)
  const scope = ref<BulkRenameScope>('changes')
  /** Applied by the server across the whole candidate set, not just the pages already loaded. */
  const search = ref('')

  const items = ref<BulkRenamePreviewItem[]>([])
  const total = ref(0)
  const pattern = ref('')
  const totalByStatus = ref<Record<BulkRenameStatus, number>>({ ...EMPTY_COUNTS })

  const loading = ref(false)
  const loadingMore = ref(false)
  const previewError = ref<BulkRenameFailure | null>(null)

  const executing = ref(false)
  const executionStats = ref<BulkRenameStats | null>(null)
  const executionError = ref<BulkRenameFailure | null>(null)
  const renamedCount = ref(0)
  /** Server-narrowed number of books this run will touch, known once the `started` event lands. */
  const runTotal = ref(0)

  let abortController: AbortController | null = null
  let loadToken = 0
  let searchTimer: ReturnType<typeof setTimeout> | null = null

  const hasMore = computed(() => items.value.length < total.value)

  onUnmounted(() => {
    abortController?.abort()
    if (searchTimer) clearTimeout(searchTimer)
  })

  async function fetchPage(page: number): Promise<void> {
    const libraryId = selectedLibraryId.value
    if (libraryId === null) return

    const token = ++loadToken
    if (page === 1) {
      loading.value = true
      previewError.value = null
    } else {
      loadingMore.value = true
    }

    try {
      const result = await bulkRenameApi.fetchBulkRenamePreview(libraryId, page, BULK_RENAME_PAGE_SIZE, SCOPE_STATUS[scope.value], search.value)
      // A newer request started while this one was in flight, so its results are the current ones.
      if (token !== loadToken) return

      items.value = page === 1 ? result.items : [...items.value, ...result.items]
      total.value = result.total
      totalByStatus.value = result.totalByStatus
      pattern.value = result.pattern
    } catch (e) {
      if (token !== loadToken) return
      previewError.value = toFailure(e)
      if (page === 1) {
        items.value = []
        total.value = 0
      }
    } finally {
      if (token === loadToken) {
        loading.value = false
        loadingMore.value = false
      }
    }
  }

  function loadPreview(): Promise<void> {
    return fetchPage(1)
  }

  function loadMore(): Promise<void> {
    if (loading.value || loadingMore.value || !hasMore.value) return Promise.resolve()
    return fetchPage(Math.floor(items.value.length / BULK_RENAME_PAGE_SIZE) + 1)
  }

  function selectLibrary(libraryId: number): void {
    selectedLibraryId.value = libraryId
    scope.value = 'changes'
    search.value = ''
    items.value = []
    total.value = 0
    pattern.value = ''
    totalByStatus.value = { ...EMPTY_COUNTS }
    executionStats.value = null
    executionError.value = null
  }

  /**
   * Debounced because every keystroke would otherwise re-page the library. The pending timer is
   * cleared first so a fast typist only ever has one request in flight.
   */
  function setSearch(next: string): void {
    if (search.value === next) return
    search.value = next
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      searchTimer = null
      items.value = []
      total.value = 0
      void loadPreview()
    }, SEARCH_DEBOUNCE_MS)
  }

  function setScope(next: BulkRenameScope): void {
    if (scope.value === next) return
    scope.value = next
    items.value = []
    total.value = 0
    void loadPreview()
  }

  async function execute(selection: BulkRenameExecuteRequest): Promise<void> {
    const libraryId = selectedLibraryId.value
    if (libraryId === null) return

    executing.value = true
    executionStats.value = null
    executionError.value = null
    renamedCount.value = 0
    runTotal.value = 0

    abortController = new AbortController()
    const controller = abortController

    try {
      const res = await bulkRenameApi.executeBulkRename(libraryId, selection, controller.signal)
      if (!res.ok) throw new BulkRenameStreamError({ code: 'http', status: res.status })
      if (!res.body) throw new BulkRenameStreamError({ code: 'noBody' })

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const raw = line.slice(6).trim()
            if (!raw) continue
            const event = JSON.parse(raw) as BulkRenameProgressEvent
            if ('started' in event) {
              runTotal.value = event.total
            } else if ('done' in event && event.done) {
              executionStats.value = {
                processed: event.processed,
                succeeded: event.succeeded,
                failed: event.failed,
                skipped: event.skipped,
              }
            } else {
              renamedCount.value++
            }
          }
        }
      } catch (e) {
        void reader.cancel().catch(() => {})
        throw e
      }

      // The server flushes headers before the run, so a failure part-way through arrives as a
      // stream that simply stops. Without this the run would be reported as a silent success.
      if (executionStats.value === null && !controller.signal.aborted) {
        throw new BulkRenameStreamError({ code: 'incomplete' })
      }
    } catch (e) {
      if (controller.signal.aborted) return
      executionError.value = toFailure(e)
    } finally {
      executing.value = false
      abortController = null
    }
  }

  function cancelExecution(): void {
    abortController?.abort()
  }

  return {
    selectedLibraryId,
    scope,
    search,
    items,
    total,
    pattern,
    totalByStatus,
    hasMore,

    loading,
    loadingMore,
    previewError,

    executing,
    executionStats,
    executionError,
    renamedCount,
    runTotal,

    selectLibrary,
    setSearch,
    setScope,
    loadPreview,
    loadMore,
    execute,
    cancelExecution,
  }
}
