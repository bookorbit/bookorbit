import { ref } from 'vue'
import { api } from '@/lib/api'
import type { Library } from '@projectx/types'

const libraries = ref<Library[]>([])

export function useLibraries() {
  async function fetchLibraries() {
    const res = await api('/api/v1/libraries')
    if (!res.ok) return
    libraries.value = await res.json()
  }

  return { libraries, fetchLibraries }
}
