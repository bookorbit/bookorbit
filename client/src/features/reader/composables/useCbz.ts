import { ref } from 'vue'

export function useCbz(fileId: number, bookId: number) {
  const pageCount = ref(0)
  const bookTitle = ref('')
  const loading = ref(true)
  const error = ref<string | null>(null)

  function pageUrl(n: number): string {
    return `/api/cbz/files/${fileId}/pages/${n}`
  }

  async function load(): Promise<void> {
    const [pagesRes, bookRes] = await Promise.all([fetch(`/api/cbz/files/${fileId}/pages`), fetch(`/api/books/${bookId}`)])
    if (!pagesRes.ok) {
      error.value = 'Failed to load comic'
      loading.value = false
      return
    }
    const [pagesData, bookData] = await Promise.all([pagesRes.json(), bookRes.ok ? bookRes.json() : null])
    pageCount.value = pagesData.pageCount
    bookTitle.value = bookData?.title ?? ''
    loading.value = false
  }

  return { pageCount, bookTitle, loading, error, pageUrl, load }
}
