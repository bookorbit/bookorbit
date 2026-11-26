import { ref } from 'vue'
import type { Permission } from '@bookorbit/types'
import { api } from '@/lib/api'

const endpoint = '/api/v1/app-settings/starting-permissions'

export function useStartingPermissions() {
  const saved = ref<Permission[] | null>(null)
  const error = ref<'load' | 'save' | null>(null)
  const busy = ref(false)

  async function request(permissionNames?: Permission[]) {
    if (busy.value) return false
    busy.value = true
    error.value = null
    try {
      const response = await api(
        endpoint,
        permissionNames
          ? {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ permissionNames }),
            }
          : undefined,
      )
      if (!response.ok) throw new Error()
      saved.value = (await response.json()) as Permission[]
      return true
    } catch {
      error.value = permissionNames ? 'save' : 'load'
      return false
    } finally {
      busy.value = false
    }
  }

  return { saved, error, busy, load: () => request(), save: (names: Permission[]) => request(names) }
}
