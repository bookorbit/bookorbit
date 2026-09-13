import { ref } from 'vue'
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

  function reset(): void {
    generation++
    review.value = null
    loading.value = false
    failed.value = false
  }

  return { review, loading, failed, fetchReview, reset }
}
