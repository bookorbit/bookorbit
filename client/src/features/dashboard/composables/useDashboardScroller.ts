import { onMounted, ref } from 'vue'

import {
  DASHBOARD_SCROLLER_BATCH_MAX,
  type BookCard,
  type DashboardScrollerBatchRequest,
  type DashboardScrollerBatchResponse,
  type DashboardScrollerBatchResult,
  type ScrollerType,
} from '@bookorbit/types'
import { api } from '@/lib/api'
import { useBookProgressRefresh } from '@/features/book/composables/useBookProgressRefresh'

type PendingScrollerRequest = {
  item: DashboardScrollerBatchRequest['items'][number]
  resolve: (result: DashboardScrollerBatchResult) => void
  reject: (reason?: unknown) => void
}

const pendingRequests: PendingScrollerRequest[] = []
let batchScheduled = false
let requestSequence = 0

function scheduleBatch(): void {
  if (batchScheduled) return
  batchScheduled = true
  queueMicrotask(() => void flushBatch())
}

async function flushBatch(): Promise<void> {
  batchScheduled = false
  const batch = pendingRequests.splice(0, DASHBOARD_SCROLLER_BATCH_MAX)
  if (batch.length === 0) return
  if (pendingRequests.length > 0) scheduleBatch()

  try {
    const body: DashboardScrollerBatchRequest = { items: batch.map((request) => request.item) }
    const response = await api('/api/v1/dashboard/scrollers/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error('Dashboard scroller batch failed')

    const payload: DashboardScrollerBatchResponse = await response.json()
    const resultsById = new Map(payload.items.map((item) => [item.id, item]))
    for (const request of batch) {
      const result = resultsById.get(request.item.id)
      if (result) request.resolve(result)
      else request.reject(new Error('Dashboard scroller batch result missing'))
    }
  } catch (error) {
    for (const request of batch) request.reject(error)
  }
}

function requestScroller(type: ScrollerType, limit: number, smartScopeId?: number): Promise<DashboardScrollerBatchResult> {
  return new Promise((resolve, reject) => {
    requestSequence += 1
    pendingRequests.push({
      item: {
        id: String(requestSequence),
        type,
        limit,
        ...(type === 'smart-scope' && smartScopeId ? { smartScopeId } : {}),
      },
      resolve,
      reject,
    })
    scheduleBatch()
  })
}

export function useDashboardScroller(type: ScrollerType, limit = 20, smartScopeId?: number) {
  const books = ref<BookCard[]>([])
  const loading = ref(true)
  const error = ref(false)

  async function load() {
    loading.value = true
    error.value = false
    try {
      const result = await requestScroller(type, limit, smartScopeId)
      books.value = result.books
      error.value = result.failed
    } catch {
      error.value = true
    } finally {
      loading.value = false
    }
  }

  useBookProgressRefresh(load)
  onMounted(load)
  return { books, loading, error, refresh: load }
}
