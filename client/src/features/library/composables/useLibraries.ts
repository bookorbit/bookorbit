import { ref } from 'vue'
import { api } from '@/lib/api'
import type { Library } from '@bookorbit/types'

const libraries = ref<Library[]>([])
const loading = ref(false)
const loaded = ref(false)
const error = ref<string | null>(null)
let fetchPromise: Promise<void> | null = null
let requestGeneration = 0

export function resetLibraries(): void {
  requestGeneration += 1
  libraries.value = []
  loading.value = false
  loaded.value = false
  error.value = null
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
    error.value = null
    const generation = requestGeneration
    fetchPromise = (async () => {
      try {
        const res = await api('/api/v1/libraries')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data: unknown = await res.json()
        if (!Array.isArray(data)) throw new Error('Invalid library response')
        if (generation !== requestGeneration) return
        libraries.value = data as Library[]
        loaded.value = true
      } catch (cause: unknown) {
        if (generation !== requestGeneration) return
        error.value = cause instanceof Error ? cause.message : 'Failed to load libraries'
      } finally {
        if (generation === requestGeneration) {
          fetchPromise = null
          loading.value = false
        }
      }
    })()
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

  return { libraries, loading, loaded, error, fetchLibraries, refreshLibraries, reorderLibraries }
}
