import { api } from '@/lib/api'

export function useTagSearch() {
  async function search(q: string): Promise<string[]> {
    if (!q.trim()) return []
    const res = await api(`/api/metadata/tags?q=${encodeURIComponent(q)}`)
    if (!res.ok) return []
    const data: { name: string }[] = await res.json()
    return data.map((t) => t.name)
  }

  return { search }
}
