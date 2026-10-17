import { onScopeDispose, ref, watch, type Ref } from 'vue'
import type {
  BookMetadataFetchBreakdown,
  BookMetadataFetchConditions,
  BookMetadataFetchPreviewBooks,
  BookMetadataFetchPreviewScope,
} from '@bookorbit/types'
import { api } from '@/lib/api'

const DEBOUNCE_MS = 250

async function post<T>(path: string, body: unknown): Promise<T | null> {
  const res = await api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return res.ok ? ((await res.json()) as T) : null
}

/**
 * Live counts and the books a draft rule would take. Earlier answers stay on screen while a newer one loads,
 * and an answer that arrives after the rule has moved on is dropped.
 */
export function useAutoFetchPreview(conditions: Ref<BookMetadataFetchConditions | null>, libraryIds: Ref<number[]>, limit: Ref<number>) {
  const breakdown = ref<BookMetadataFetchBreakdown | null>(null)
  const books = ref<BookMetadataFetchPreviewBooks | null>(null)
  const pending = ref(false)
  const failed = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null
  let request = 0

  async function load() {
    const current = ++request
    const draft = conditions.value
    if (!draft) return
    pending.value = true
    const scope: BookMetadataFetchPreviewScope = { conditions: draft, libraryIds: libraryIds.value }
    try {
      const [nextBreakdown, nextBooks] = await Promise.all([
        post<BookMetadataFetchBreakdown>('/api/v1/book-metadata-fetch/preview-breakdown', scope),
        post<BookMetadataFetchPreviewBooks>('/api/v1/book-metadata-fetch/preview-books', { ...scope, limit: limit.value }),
      ])
      if (current !== request) return
      failed.value = !nextBreakdown || !nextBooks
      if (nextBreakdown) breakdown.value = nextBreakdown
      if (nextBooks) books.value = nextBooks
    } catch {
      if (current === request) failed.value = true
    } finally {
      if (current === request) pending.value = false
    }
  }

  function schedule() {
    request += 1
    if (timer) clearTimeout(timer)
    timer = setTimeout(load, DEBOUNCE_MS)
  }

  watch([conditions, libraryIds, limit], schedule, { deep: true, immediate: true })
  onScopeDispose(() => {
    request += 1
    if (timer) clearTimeout(timer)
  })

  return { breakdown, books, pending, failed, refresh: schedule }
}
