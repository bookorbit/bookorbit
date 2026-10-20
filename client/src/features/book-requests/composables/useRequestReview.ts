import { computed, ref } from 'vue'
import { api } from '@/lib/api'
import { fulfilmentBase } from '../fulfilmentBase'
import type { BookRequestReview } from '@bookorbit/types'

/**
 * What landed in the Book Dock for a held request, and how it scored against what was asked for.
 *
 * Fetched separately from the request rather than carried on it: the list renders every row and
 * this costs a dock read, a unit-file read and a settings read for the one row someone opened.
 */
export function useRequestReview(canManage: () => boolean) {
  const basePath = () => fulfilmentBase(canManage())
  const review = ref<BookRequestReview | null>(null)
  const loading = ref(false)
  const failed = ref(false)
  /** Bumped per fetch, so stepping to the next request cannot be answered with the last one's. */
  let generation = 0

  async function fetchReview(id: number): Promise<void> {
    const current = ++generation
    loading.value = true
    failed.value = false

    try {
      const res = await api(`${basePath()}/${id}/review`)
      if (current !== generation) return
      if (!res.ok) {
        // A request that left `needs_review` while the drawer was open answers 400 here. That is
        // not an error worth showing: the panel simply no longer applies.
        review.value = null
        failed.value = res.status >= 500
        return
      }
      const payload = (await res.json()) as BookRequestReview
      if (current !== generation) return
      review.value = payload
    } catch {
      if (current !== generation) return
      review.value = null
      failed.value = true
    } finally {
      if (current === generation) loading.value = false
    }
  }

  /**
   * Keyed on the dock entry as well as the request: discarding an import and grabbing another
   * leaves the request id unchanged, and the browser would otherwise keep showing the first cover.
   */
  const coverUrl = computed(() => {
    const current = review.value
    if (!current?.hasCover || current.bookDockFileId === null) return null
    return `${basePath()}/${current.requestId}/review/cover?entry=${current.bookDockFileId}`
  })

  function reset(): void {
    generation++
    review.value = null
    loading.value = false
    failed.value = false
  }

  return { review, coverUrl, loading, failed, fetchReview, reset }
}
