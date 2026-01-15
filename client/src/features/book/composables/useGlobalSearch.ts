import { ref, watch, type Ref } from 'vue'
import { api } from '@/lib/api'

export interface GlobalSearchResult {
  id: number
  title: string | null
  authors: string[]
  libraryId: number
  libraryName: string
}

export function useGlobalSearch(query: Ref<string>) {
  const results = ref<GlobalSearchResult[]>([])
  const loading = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  watch(query, (q) => {
    if (timer) clearTimeout(timer)
    if (q.trim().length < 2) {
      results.value = []
      loading.value = false
      return
    }
    loading.value = true
    timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: q.trim(), limit: '10' })
        const res = await api(`/api/books/search?${params}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        results.value = await res.json()
      } catch {
        results.value = []
      } finally {
        loading.value = false
      }
    }, 300)
  })

  function clear() {
    if (timer) clearTimeout(timer)
    results.value = []
    loading.value = false
  }

  return { results, loading, clear }
}
