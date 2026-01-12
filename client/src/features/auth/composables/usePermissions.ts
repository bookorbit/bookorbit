import { computed } from 'vue'
import { useAuth } from './useAuth'

export function usePermissions() {
  const { user } = useAuth()

  const isSuperuser = computed(() => user.value?.permissions.includes('*') ?? false)
  const userPermissions = computed(() => user.value?.permissions ?? [])

  function hasPermission(name: string): boolean {
    return userPermissions.value.includes('*') || userPermissions.value.includes(name)
  }

  return { hasPermission, isSuperuser, userPermissions }
}
