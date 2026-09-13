import { ref } from 'vue'
import type { BookDetail } from '@bookorbit/types'
import { api } from '@/lib/api'

/** The series a book is read as part of: its first membership, matching how the book pages order them. */
function primarySeriesId(book: BookDetail | null): number | null {
  const memberships = book?.seriesMemberships ?? []
  const primary = [...memberships].sort((a, b) => a.displayOrder - b.displayOrder)[0]
  return primary?.seriesId ?? book?.seriesId ?? null
}

export function useCbz(fileId: number, bookId: number) {
  const pageCount = ref(0)
  const bookTitle = ref('')
  const seriesId = ref<number | null>(null)
  const loading = ref(true)
  const error = ref<string | null>(null)

  function pageUrl(n: number): string {
    return `/api/v1/cbz/files/${fileId}/pages/${n}`
  }

  async function load(): Promise<void> {
    const [pagesRes, bookRes] = await Promise.all([api(`/api/v1/cbz/files/${fileId}/pages`), api(`/api/v1/books/${bookId}`)])
    if (!pagesRes.ok) {
      error.value = 'Failed to load comic'
      loading.value = false
      return
    }
    const [pagesData, bookData] = await Promise.all([pagesRes.json(), bookRes.ok ? bookRes.json() : null])
    pageCount.value = pagesData.pageCount
    bookTitle.value = bookData?.title ?? ''
    seriesId.value = primarySeriesId(bookData)
    loading.value = false
  }

  return { pageCount, bookTitle, seriesId, loading, error, pageUrl, load }
}
