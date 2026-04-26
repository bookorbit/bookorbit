import { computed } from 'vue'
import { Permission } from '@bookorbit/types'
import { useAuth } from './useAuth'

export function usePermissions() {
  const { user } = useAuth()

  const isSuperuser = computed(() => user.value?.isSuperuser ?? false)
  const userPermissions = computed(() => user.value?.permissions ?? [])

  function hasPermission(name: string): boolean {
    return isSuperuser.value || userPermissions.value.includes(name)
  }

  function hasExplicitPermission(name: string): boolean {
    return userPermissions.value.includes(name)
  }

  const isDemoRestrictedAccount = computed(() => hasExplicitPermission(Permission.DemoRestricted))

  return { hasPermission, hasExplicitPermission, isDemoRestrictedAccount, isSuperuser, userPermissions }
}
