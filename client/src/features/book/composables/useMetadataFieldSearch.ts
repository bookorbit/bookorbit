import { api } from '@/lib/api'

function createSearchFn(endpoint: string) {
  return async (q: string): Promise<string[]> => {
    if (!q.trim()) return []
    const res = await api(`${endpoint}?q=${encodeURIComponent(q)}`)
    if (!res.ok) return []
    const data: { name: string }[] = await res.json()
    return data.map((d) => d.name)
  }
}

export function usePublisherSearch() {
  return { search: createSearchFn('/api/v1/metadata/publishers') }
}

export function useSeriesNameSearch() {
  return { search: createSearchFn('/api/v1/metadata/series') }
}

export function useLanguageSearch() {
  return { search: createSearchFn('/api/v1/metadata/languages') }
}
