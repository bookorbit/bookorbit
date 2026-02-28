import { api } from '@/lib/api'

export function useAuthorSearch() {
  async function search(q: string): Promise<string[]> {
    if (!q.trim()) return []
    const res = await api(`/api/v1/metadata/authors?q=${encodeURIComponent(q)}`)
    if (!res.ok) return []
    const data: { name: string }[] = await res.json()
    return data.map((a) => a.name)
  }

  return { search }
}
