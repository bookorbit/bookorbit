import { ref } from 'vue'
import type { ReaderFormatGroup, SeriesNextBook, SeriesNextBookResponse } from '@bookorbit/types'
import { api } from '@/lib/api'

/**
 * The next book of a series that this reader can open, resolved server-side so a long series is
 * never paged through on the client. A book outside any series, or one at the end, yields null.
 */
export function useSeriesNextBook(formatGroup: ReaderFormatGroup) {
  const nextBook = ref<SeriesNextBook | null>(null)

  // Nothing here is worth interrupting the reader for: without an answer the reader simply ends
  // at the last page, the way it did before there was a handoff.
  async function load(seriesId: number | null, bookId: number): Promise<void> {
    nextBook.value = null
    if (seriesId === null) return

    try {
      const res = await api(`/api/v1/series/${seriesId}/books/${bookId}/next?formatGroup=${formatGroup}`)
      if (!res.ok) return

      const data = (await res.json()) as SeriesNextBookResponse
      nextBook.value = data.next ?? null
    } catch {
      nextBook.value = null
    }
  }

  return { nextBook, load }
}
