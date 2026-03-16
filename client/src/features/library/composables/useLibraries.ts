import { ref } from 'vue'
import { api } from '@/lib/api'
import type { Library } from '@projectx/types'

const libraries = ref<Library[]>([])
let loaded = false
let fetchPromise: Promise<void> | null = null

export function useLibraries() {
  async function fetchLibraries(): Promise<void> {
    if (loaded) return
    return refreshLibraries()
  }

  async function refreshLibraries(): Promise<void> {
    if (fetchPromise) return fetchPromise
    fetchPromise = api('/api/v1/libraries')
      .then(async (res) => {
        if (!res.ok) return
        libraries.value = await res.json()
        loaded = true
      })
      .finally(() => {
        fetchPromise = null
      })
    return fetchPromise
  }

  async function reorderLibraries(order: { id: number; displayOrder: number }[]): Promise<void> {
    const res = await api('/api/v1/libraries/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order }),
    })
    if (!res.ok) throw new Error('Failed to reorder libraries')
  }

  return { libraries, fetchLibraries, refreshLibraries, reorderLibraries }
}
