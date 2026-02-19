import { api } from '@/lib/api'

function useMetadataSearch(endpoint: string) {
  async function search(q: string): Promise<string[]> {
    if (!q.trim()) return []
    const res = await api(`/api/metadata/${endpoint}?q=${encodeURIComponent(q)}`)
    if (!res.ok) return []
    const data: { name: string }[] = await res.json()
    return data.map((item) => item.name)
  }
  return { search }
}

export const useGenreSearch = () => useMetadataSearch('genres')
export const useTagSearch = () => useMetadataSearch('tags')
