import { computed } from 'vue'
import { useAuth } from './useAuth'

export function usePermissions() {
  const { user } = useAuth()

  const isSuperuser = computed(() => {
    if (!user.value) return false
    return user.value.permissions.includes('*') || user.value.roles.some((role) => role.isSuperuser)
  })
  const userPermissions = computed(() => user.value?.permissions ?? [])

  function hasPermission(name: string): boolean {
    return isSuperuser.value || userPermissions.value.includes(name)
  }

  return { hasPermission, isSuperuser, userPermissions }
}
