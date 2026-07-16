import { ref } from 'vue'
import { api } from '@/lib/api'
import type { Library } from '@bookorbit/types'

const libraries = ref<Library[]>([])
const loading = ref(false)
const loaded = ref(false)
let fetchPromise: Promise<void> | null = null
let requestGeneration = 0

export function resetLibraries(): void {
  requestGeneration += 1
  libraries.value = []
  loading.value = false
  loaded.value = false
  fetchPromise = null
}

export function useLibraries() {
  async function fetchLibraries(): Promise<void> {
    if (loaded.value) return
    return refreshLibraries()
  }

  async function refreshLibraries(): Promise<void> {
    if (fetchPromise) return fetchPromise
    loading.value = true
    const generation = requestGeneration
    fetchPromise = api('/api/v1/libraries')
      .then(async (res) => {
        if (!res.ok) return
        const nextLibraries: Library[] = await res.json()
        if (generation !== requestGeneration) return
        libraries.value = nextLibraries
        loaded.value = true
      })
      .finally(() => {
        if (generation === requestGeneration) {
          fetchPromise = null
          loading.value = false
        }
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

  return { libraries, loading, loaded, fetchLibraries, refreshLibraries, reorderLibraries }
}
