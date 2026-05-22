import { api } from '@/lib/api'

interface NamedItem {
  id: number
  name: string
}

async function searchWithIds(endpoint: string, q: string): Promise<NamedItem[]> {
  if (!q.trim()) return []
  const res = await api(`/api/v1/metadata/${endpoint}?q=${encodeURIComponent(q)}`)
  if (!res.ok) return []
  return res.json() as Promise<NamedItem[]>
}

export function useTagSearchWithIds() {
  return {
    search: (q: string) => searchWithIds('tags', q),
  }
}

export function useGenreSearchWithIds() {
  return {
    search: (q: string) => searchWithIds('genres', q),
  }
}
