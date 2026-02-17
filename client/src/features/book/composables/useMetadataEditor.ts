import { computed, reactive, ref } from 'vue'
import { api } from '@/lib/api'
import type { BookDetail } from '@projectx/types'

export function useMetadataEditor() {
  const saving = ref(false)
  const error = ref<string | null>(null)

  const form = reactive({
    title: null as string | null,
    subtitle: null as string | null,
    description: null as string | null,
    publisher: null as string | null,
    publishedYear: null as number | null,
    language: null as string | null,
    pageCount: null as number | null,
    seriesName: null as string | null,
    seriesIndex: null as number | null,
    isbn10: null as string | null,
    isbn13: null as string | null,
    rating: null as number | null,
    authors: [] as string[],
    tags: [] as string[],
  })

  let snapshot = JSON.stringify(form)

  const isDirty = computed(() => JSON.stringify(form) !== snapshot)

  function load(book: BookDetail) {
    form.title = book.title
    form.subtitle = book.subtitle
    form.description = book.description
    form.publisher = book.publisher
    form.publishedYear = book.publishedYear
    form.language = book.language
    form.pageCount = book.pageCount
    form.seriesName = book.seriesName
    form.seriesIndex = book.seriesIndex
    form.isbn10 = book.isbn10
    form.isbn13 = book.isbn13
    form.rating = book.rating ?? null
    form.authors = book.authors.map((a) => a.name)
    form.tags = [...book.tags]
    snapshot = JSON.stringify(form)
    error.value = null
  }

  function reset() {
    const s = JSON.parse(snapshot)
    Object.assign(form, s)
    error.value = null
  }

  async function save(bookId: number): Promise<BookDetail | null> {
    saving.value = true
    error.value = null
    try {
      const res = await api(`/api/books/${bookId}/metadata`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const updated: BookDetail = await res.json()
      snapshot = JSON.stringify(form)
      return updated
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to save'
      return null
    } finally {
      saving.value = false
    }
  }

  return { form, saving, error, isDirty, load, reset, save }
}
