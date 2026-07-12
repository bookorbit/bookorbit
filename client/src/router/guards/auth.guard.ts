import type { Router } from 'vue-router'
import { useAuth } from '@/features/auth/composables/useAuth'
import { useChangePasswordDialog } from '@/composables/useChangePasswordDialog'
import { useSetupStatus } from '@/features/auth/composables/useSetupStatus'

export function registerAuthGuard(router: Router): void {
  router.beforeEach(async (to) => {
    const { fetchSetupStatus } = useSetupStatus()
    let requiresSetup = false
    try {
      requiresSetup = await fetchSetupStatus()
    } catch {
      // If setup-status cannot be loaded, fall back to normal auth checks.
    }
    if (requiresSetup && to.path !== '/setup') {
      return { path: '/setup' }
    }

    if (!requiresSetup && to.path === '/setup') {
      const { user } = useAuth()
      return user.value ? { path: '/' } : { path: '/login' }
    }

    if (to.meta.public) return true

    const { user } = useAuth()

    if (!user.value) {
      return { path: '/login', query: { redirect: to.fullPath } }
    }

    if (user.value.isDefaultPassword && user.value.provisioningMethod !== 'shared') {
      useChangePasswordDialog().open(true)
      // Allow navigation to '/' but block everything else
      if (to.path !== '/') return { path: '/' }
    }

    if (to.name === 'achievements' && user.value.settings.achievementPreferences?.enabled === false) {
      return { name: 'settings-account', query: { tab: 'profile' } }
    }

    return true
  })
}
