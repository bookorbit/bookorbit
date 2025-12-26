import { ref } from 'vue'

export interface SearchExcerpt {
  pre: string
  match: string
  post: string
}

export interface SearchResult {
  cfi: string
  excerpt: SearchExcerpt
  sectionTitle?: string
}

export function useSearch() {
  const query = ref('')
  const results = ref<SearchResult[]>([])
  const isSearching = ref(false)

  let cancelled = false

  async function search(view: any, q: string) {
    if (!q.trim()) {
      results.value = []
      return
    }

    cancelled = true
    await Promise.resolve()
    cancelled = false

    query.value = q
    results.value = []
    isSearching.value = true

    try {
      const generator = view.search({ query: q })
      for await (const section of generator) {
        if (cancelled) break
        // Skip progress events and the 'done' sentinel
        if (!section || typeof section !== 'object' || !('subitems' in section)) continue
        const sectionTitle: string = section.label ?? ''
        const newItems: SearchResult[] = (section.subitems ?? []).map((item: any) => ({
          cfi: item.cfi ?? '',
          sectionTitle,
          excerpt: item.excerpt ?? { pre: '', match: '', post: '' },
        }))
        if (newItems.length > 0) {
          results.value = [...results.value, ...newItems]
        }
      }
    } catch {
      // search cancelled or view destroyed
    } finally {
      if (!cancelled) {
        isSearching.value = false
      }
    }
  }

  function clear(view: any) {
    cancelled = true
    isSearching.value = false
    results.value = []
    query.value = ''
    view?.clearSearch?.()
  }

  return { query, results, isSearching, search, clear }
}
