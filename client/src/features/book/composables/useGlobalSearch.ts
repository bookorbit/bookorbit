import { ref, watch, type Ref } from 'vue'
import { api } from '@/lib/api'

export interface GlobalSearchResult {
  id: number
  title: string | null
  seriesName: string | null
  authors: string[]
  libraryId: number
  libraryName: string
  formats: string[]
}

export function useGlobalSearch(query: Ref<string>) {
  const results = ref<GlobalSearchResult[]>([])
  const loading = ref(false)
  const settled = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  watch(query, (q) => {
    if (timer) clearTimeout(timer)
    settled.value = false
    if (q.trim().length < 2) {
      results.value = []
      loading.value = false
      return
    }
    loading.value = true
    timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: q.trim(), limit: '10' })
        const res = await api(`/api/v1/books/search?${params}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        results.value = await res.json()
      } catch {
        results.value = []
      } finally {
        loading.value = false
        settled.value = true
      }
    }, 300)
  })

  function clear() {
    if (timer) clearTimeout(timer)
    results.value = []
    loading.value = false
    settled.value = false
  }

  return { results, loading, settled, clear }
}
