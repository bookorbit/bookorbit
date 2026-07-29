import { computed, ref, type Ref } from 'vue'
import { Permission, type SmartScope } from '@bookorbit/types'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useSmartScopes } from './useSmartScopes'

/**
 * Kobo sync for a shared Smart Scope is a per-user opt-in: the owner's own toggle lives in
 * the editor and only governs their devices, so a viewer needs a separate control here.
 */
export function useSmartScopeKoboSync(smartScope: Ref<SmartScope | null | undefined>) {
  const { hasPermission } = usePermissions()
  const { setKoboSync } = useSmartScopes()

  const pending = ref(false)
  const isOwner = computed(() => smartScope.value?.isOwner ?? false)
  const enabled = computed(() => smartScope.value?.koboSyncEnabled ?? false)
  const canToggle = computed(() => Boolean(smartScope.value) && !isOwner.value && hasPermission(Permission.KoboSync))

  async function toggle(): Promise<boolean | null> {
    const scope = smartScope.value
    if (!scope || !canToggle.value || pending.value) return null
    const next = !scope.koboSyncEnabled
    pending.value = true
    try {
      await setKoboSync(scope.id, next)
      return next
    } finally {
      pending.value = false
    }
  }

  return { isOwner, enabled, canToggle, pending, toggle }
}
