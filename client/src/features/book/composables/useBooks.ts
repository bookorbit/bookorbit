import { ref, computed, type Ref } from 'vue'
import { api } from '@/lib/api'

export interface BookFile {
  id: number
  format: string | null
  role: string
}

export interface Book {
  id: number
  status: string
  title: string | null
  authors: string[]
  seriesName: string | null
  seriesIndex: number | null
  files: BookFile[]
}

interface BooksPage {
  items: Book[]
  total: number
  page: number
  size: number
}

// Deterministic per-book cover hue from title — OKLch, always dark and readable.
export function bookCoverStyle(seed: string): { background: string; color: string } {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  return {
    background: `oklch(0.22 0.07 ${hue})`,
    color: `oklch(0.92 0.03 ${hue})`,
  }
}

const PAGE_SIZE = 50

export function useBooks(libraryId: Ref<number | null>) {
  const books = ref<Book[]>([])
  const total = ref(0)
  const page = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const search = ref('')

  const hasMore = computed(() => books.value.length < total.value)

  async function load(reset = false) {
    if (loading.value || libraryId.value === null) return
    loading.value = true
    error.value = null

    try {
      const currentPage = reset ? 0 : page.value
      const params = new URLSearchParams({
        libraryId: String(libraryId.value),
        page: String(currentPage),
        size: String(PAGE_SIZE),
      })
      if (search.value.trim()) params.set('search', search.value.trim())

      const res = await api(`/api/books?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const data: BooksPage = await res.json()

      if (reset) {
        books.value = data.items
        page.value = 1
      } else {
        books.value.push(...data.items)
        page.value = currentPage + 1
      }
      total.value = data.total
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load books'
    } finally {
      loading.value = false
    }
  }

  function clear() {
    books.value = []
    total.value = 0
    page.value = 0
  }

  function onSearch() {
    load(true)
  }

  return { books, total, loading, error, search, hasMore, load, onSearch, clear }
}
