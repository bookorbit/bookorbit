import { onScopeDispose, ref } from 'vue'
import type { BookDetail, ComicPageCountResponse } from '@bookorbit/types'
import { api } from '@/lib/api'

/** The series a book is read as part of: its first membership, matching how the book pages order them. */
function primarySeriesId(book: BookDetail | null): number | null {
  const memberships = book?.seriesMemberships ?? []
  const primary = [...memberships].sort((a, b) => a.displayOrder - b.displayOrder)[0]
  return primary?.seriesId ?? book?.seriesId ?? null
}

export function useCbz(fileId: number, bookId: number, source: 'cbz' | 'djvu' = 'cbz') {
  const pageCount = ref(0)
  const bookTitle = ref('')
  const seriesId = ref<number | null>(null)
  const loading = ref(true)
  const error = ref<string | null>(null)

  let controller: AbortController | null = null
  let disposed = false
  onScopeDispose(() => {
    disposed = true
    controller?.abort()
  })

  function pageUrl(n: number): string {
    return `/api/v1/${source}/files/${fileId}/pages/${n}${source === 'djvu' ? '?size=2560' : ''}`
  }

  async function load(): Promise<void> {
    controller?.abort()
    const request = new AbortController()
    controller = request
    loading.value = true
    error.value = null
    try {
      // The book detail only supplies the title and series; the pages open without it.
      const [pagesRes, bookRes] = await Promise.all([
        api(`/api/v1/${source}/files/${fileId}/pages`, { signal: request.signal }),
        api(`/api/v1/books/${bookId}`, { signal: request.signal }).catch(() => null),
      ])
      if (!pagesRes.ok) throw new Error('Reader request failed')
      const [pagesData, bookData] = await Promise.all([
        pagesRes.json() as Promise<ComicPageCountResponse>,
        bookRes?.ok ? (bookRes.json() as Promise<BookDetail>).catch(() => null) : Promise.resolve(null),
      ])
      if (!Number.isInteger(pagesData.pageCount) || pagesData.pageCount < 1) throw new Error('Invalid page count')
      if (disposed || controller !== request) return
      pageCount.value = pagesData.pageCount
      bookTitle.value = bookData?.title || bookData?.files?.find((file) => file.id === fileId)?.filename?.replace(/\.[^.]+$/, '') || ''
      seriesId.value = primarySeriesId(bookData)
    } catch {
      if (!disposed && controller === request && !request.signal.aborted) error.value = 'reader.pageImages.loadFailed'
    } finally {
      if (!disposed && controller === request) loading.value = false
    }
  }

  return { pageCount, bookTitle, seriesId, loading, error, pageUrl, load }
}
