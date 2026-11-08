import { ref } from 'vue'
import { api } from '@/lib/api'
import { BOOK_MERGED_ERROR_CODE, type BookDetail } from '@bookorbit/types'

/** The kept book's id when a 404 says this id was merged into it; null for any other 404. */
async function readMergedTarget(res: Response): Promise<number | null> {
  const body = (await res.json().catch(() => null)) as { errorCode?: unknown; errorMeta?: { targetBookId?: unknown } } | null
  if (body?.errorCode !== BOOK_MERGED_ERROR_CODE) return null
  const target = body.errorMeta?.targetBookId
  return typeof target === 'number' && Number.isInteger(target) && target > 0 ? target : null
}

export function useBookDetail() {
  const detail = ref<BookDetail | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const notFound = ref(false)
  /** Set when the requested id was merged away; the view sends the reader on to this book (E8). */
  const mergedInto = ref<number | null>(null)
  let activeRequestId = 0

  async function fetch(bookId: number) {
    const requestId = ++activeRequestId
    const shouldClearDetail = detail.value?.id !== bookId
    loading.value = true
    error.value = null
    notFound.value = false
    mergedInto.value = null
    if (shouldClearDetail) detail.value = null

    try {
      const res = await api(`/api/v1/books/${bookId}`)
      if (requestId === activeRequestId && res.status === 404) {
        const target = await readMergedTarget(res)
        if (requestId === activeRequestId) {
          if (target !== null) mergedInto.value = target
          else notFound.value = true
        }
      }
      if (requestId === activeRequestId && res.status !== 404) {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const nextDetail = (await res.json()) as BookDetail
        if (requestId === activeRequestId) {
          detail.value = nextDetail
        }
      }
    } catch (e) {
      if (requestId === activeRequestId) {
        error.value = e instanceof Error ? e.message : 'Failed to load book'
      }
    }

    if (requestId === activeRequestId) {
      loading.value = false
    }
  }

  return { detail, loading, error, notFound, mergedInto, fetch }
}
