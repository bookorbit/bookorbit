import { computed, ref, watch, type Ref } from 'vue'
import type { ReadingAttempt, ReadingAttemptListResponse, ReadingAttemptOutcome, UserBookStatus } from '@bookorbit/types'
import { api } from '@/lib/api'

export type ReadingAttemptDraft = {
  startedOn: string | null
  endedOn: string | null
  outcome: ReadingAttemptOutcome | null
}

const PAGE_SIZE = 50

/**
 * Reading attempts for one book. The ledger and the attempts card both need the same list -
 * the ledger to mark where an attempt began between two sessions - so it is loaded once here
 * rather than fetched by each panel.
 */
export function useReadingAttempts(bookIdRef: Ref<number>) {
  const attempts = ref<ReadingAttempt[]>([])
  const total = ref(0)
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)

  const byId = computed(() => new Map(attempts.value.map((attempt) => [attempt.id, attempt])))
  /** Oldest first, so "attempt 2" means the second one the reader started. */
  const ordinalById = computed(() => {
    const ordered = [...attempts.value].sort((left, right) => left.id - right.id)
    return new Map(ordered.map((attempt, index) => [attempt.id, index + 1]))
  })

  async function load() {
    const bookId = bookIdRef.value
    loading.value = true
    error.value = null
    try {
      const res = await api(`/api/v1/books/${bookId}/reading-attempts?page=1&pageSize=${PAGE_SIZE}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as ReadingAttemptListResponse
      if (bookId !== bookIdRef.value) return
      attempts.value = data.items
      total.value = data.total
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Failed to load reading history'
    } finally {
      loading.value = false
    }
  }

  async function save(draft: ReadingAttemptDraft, attemptId: number | null) {
    const bookId = bookIdRef.value
    saving.value = true
    error.value = null
    try {
      const path = attemptId ? `/api/v1/books/${bookId}/reading-attempts/${attemptId}` : `/api/v1/books/${bookId}/reading-attempts`
      const res = await api(path, {
        method: attemptId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await load()
      return true
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Failed to save reading attempt'
      return false
    } finally {
      saving.value = false
    }
  }

  async function startReread(resetProgress: boolean): Promise<UserBookStatus | null> {
    const bookId = bookIdRef.value
    saving.value = true
    error.value = null
    try {
      const res = await api(`/api/v1/books/${bookId}/reading-attempts/start-reread`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetProgress }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const readStatus = (await res.json()) as UserBookStatus
      await load()
      return readStatus
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Failed to start reread'
      return null
    } finally {
      saving.value = false
    }
  }

  async function remove(attemptId: number) {
    const bookId = bookIdRef.value
    error.value = null
    const res = await api(`/api/v1/books/${bookId}/reading-attempts/${attemptId}`, { method: 'DELETE' })
    if (!res.ok) {
      error.value = 'Failed to delete reading attempt'
      return false
    }
    await load()
    return true
  }

  watch(bookIdRef, () => void load(), { immediate: true })

  return { attempts, total, loading, saving, error, byId, ordinalById, load, save, startReread, remove }
}
