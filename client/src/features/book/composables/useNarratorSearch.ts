import { api } from '@/lib/api'

export function useNarratorSearch() {
  async function search(q: string): Promise<string[]> {
    if (!q.trim()) return []
    const res = await api(`/api/v1/metadata/narrators?q=${encodeURIComponent(q)}`)
    if (!res.ok) return []
    const data: { name: string }[] = await res.json()
    return data.map((n) => n.name)
  }

  return { search }
}
