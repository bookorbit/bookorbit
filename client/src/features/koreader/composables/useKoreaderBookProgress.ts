import { ref } from 'vue'
import { api } from '@/lib/api'
import type { KoreaderBookSyncInfo } from '@bookorbit/types'

export function useKoreaderBookProgress() {
  const bookProgress = ref<KoreaderBookSyncInfo | null>(null)
  const loading = ref(false)
  let activeBookId: number | null = null
  let fetchVersion = 0

  function clearBookProgress() {
    fetchVersion += 1
    activeBookId = null
    bookProgress.value = null
    loading.value = false
  }

  async function fetchBookProgress(bookId: number, options: { preserveOnError?: boolean } = {}): Promise<boolean> {
    const version = ++fetchVersion
    if (activeBookId !== bookId) bookProgress.value = null
    activeBookId = bookId
    loading.value = true
    try {
      const res = await api(`/api/v1/koreader/books/${bookId}/progress`)
      if (!res.ok) throw new Error('Failed to fetch book progress')
      const progress = await res.json()
      if (version !== fetchVersion) return false
      bookProgress.value = progress
      return true
    } catch {
      if (version === fetchVersion && !options.preserveOnError) bookProgress.value = null
      return false
    } finally {
      if (version === fetchVersion) loading.value = false
    }
  }

  async function releaseResetHold(bookId: number, deviceId: string): Promise<boolean> {
    const version = fetchVersion
    try {
      const res = await api(`/api/v1/koreader/books/${bookId}/reset-hold/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      })
      if (!res.ok) return false
      // A release can finish after navigation; it must not replace the new book's progress.
      if (activeBookId !== bookId && (activeBookId !== null || version !== fetchVersion)) return true
      const refreshed = await fetchBookProgress(bookId, { preserveOnError: true })
      return refreshed && bookProgress.value !== null && !(bookProgress.value.heldByReset ?? []).some((held) => held.deviceId === deviceId)
    } catch {
      return false
    }
  }

  return { bookProgress, loading, fetchBookProgress, clearBookProgress, releaseResetHold }
}
