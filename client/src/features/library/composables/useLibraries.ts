import { ref } from 'vue'
import { api } from '@/lib/api'
import { createCoalescedFetch, createRequestGeneration } from '@/lib/async'
import type { Library } from '@bookorbit/types'

const libraries = ref<Library[]>([])
const loading = ref(false)
const loaded = ref(false)
const error = ref<string | null>(null)
const listGeneration = createRequestGeneration()

const loadLibraries = createCoalescedFetch(async (): Promise<void> => {
  loading.value = true
  error.value = null
  const generation = listGeneration.current()
  try {
    const res = await api('/api/v1/libraries')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data: unknown = await res.json()
    if (!Array.isArray(data)) throw new Error('Invalid library response')
    if (!listGeneration.isCurrent(generation)) return
    libraries.value = data as Library[]
    loaded.value = true
  } catch (cause: unknown) {
    if (!listGeneration.isCurrent(generation)) return
    error.value = cause instanceof Error ? cause.message : 'Failed to load libraries'
  } finally {
    if (listGeneration.isCurrent(generation)) loading.value = false
  }
})

export function resetLibraries(): void {
  listGeneration.invalidate()
  libraries.value = []
  loading.value = false
  loaded.value = false
  error.value = null
  loadLibraries.clear()
}

export function useLibraries() {
  async function fetchLibraries(): Promise<void> {
    if (loaded.value) return
    return refreshLibraries()
  }

  async function refreshLibraries(): Promise<void> {
    return loadLibraries()
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
