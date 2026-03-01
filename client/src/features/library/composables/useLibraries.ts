import { ref } from 'vue'
import { api } from '@/lib/api'
import type { Library } from '@projectx/types'

const libraries = ref<Library[]>([])
let fetchPromise: Promise<void> | null = null

export function useLibraries() {
  async function fetchLibraries(): Promise<void> {
    if (fetchPromise) return fetchPromise
    fetchPromise = api('/api/v1/libraries')
      .then(async (res) => {
        if (!res.ok) return
        libraries.value = await res.json()
      })
      .finally(() => {
        fetchPromise = null
      })
    return fetchPromise
  }

  return { libraries, fetchLibraries }
}
