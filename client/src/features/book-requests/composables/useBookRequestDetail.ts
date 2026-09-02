import { ref } from 'vue'
import { api } from '@/lib/api'
import type { BookRequestItem } from '@bookorbit/types'

export type BookRequestDetailError = 'notFound' | 'forbidden' | 'loadFailed'

interface FetchBookRequestOptions {
  background?: boolean
}

/**
 * One request, fetched by id. The detail page is reachable by link and survives a refresh, so it
 * cannot assume the list already fetched the row it is showing.
 */
export function useBookRequestDetail() {
  const request = ref<BookRequestItem | null>(null)
  const loading = ref(false)
  const error = ref<BookRequestDetailError | null>(null)
  /**
   * Bumped per fetch so an answer about the request that was open a moment ago cannot land on the
   * one open now. The drawer is a function of the URL, and stepping through the queue asks for the
   * next request before the previous answer has arrived.
   */
  let generation = 0

  async function fetchRequest(id: number, options: FetchBookRequestOptions = {}): Promise<void> {
    const current = ++generation
    const preserveCurrentRequest = options.background === true && request.value?.id === id
    if (!preserveCurrentRequest) loading.value = true
    error.value = null

    try {
      const res = await api(`/api/v1/book-requests/${id}`)
      if (current !== generation) return
      if (res.status === 404) {
        error.value = 'notFound'
        return
      }
      // The server distinguishes "no such request" from "not yours", and so should the page: one
      // is a dead link and the other is a request that exists and is somebody else's.
      if (res.status === 403) {
        error.value = 'forbidden'
        return
      }
      if (!res.ok) {
        if (!preserveCurrentRequest) error.value = 'loadFailed'
        return
      }
      const payload = (await res.json()) as BookRequestItem
      if (current !== generation) return
      request.value = payload
    } catch {
      if (current === generation && !preserveCurrentRequest) error.value = 'loadFailed'
    } finally {
      if (current === generation && !preserveCurrentRequest) loading.value = false
    }
  }

  function setRequest(updated: BookRequestItem): void {
    // A fetch still in flight was asked before this, so its answer is the older one of the two.
    generation++
    request.value = updated
  }

  return { request, loading, error, fetchRequest, setRequest }
}
