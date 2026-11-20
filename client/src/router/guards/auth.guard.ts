import type { Router } from 'vue-router'
import type { Permission } from '@bookorbit/types'
import { useAuth } from '@/features/auth/composables/useAuth'
import { useChangePasswordDialog } from '@/composables/useChangePasswordDialog'
import { useSetupStatus } from '@/features/auth/composables/useSetupStatus'
import { useLoginOptions } from '@/features/auth/composables/useLoginOptions'
import { whenSessionResolved } from '@/features/auth/composables/useSessionBootstrap'

const PASSWORD_ONLY_PUBLIC_PATHS = new Set(['/forgot-password', '/reset-password'])

function permissionFallback(name: string | undefined) {
  return name ? { name } : { path: '/' }
}

function holdsRequired(required: Permission | readonly Permission[], permissions: readonly string[]): boolean {
  const anyOf: readonly Permission[] = typeof required === 'string' ? [required] : required
  return anyOf.some((permission) => permissions.includes(permission))
}

export function registerAuthGuard(router: Router): void {
  router.beforeEach(async (to) => {
    // No user while the server is unreachable means "not known yet", not "signed out".
    await whenSessionResolved()
    const { fetchSetupStatus } = useSetupStatus()
    const { fetchLoginOptions, loginOptions } = useLoginOptions()
    let requiresSetup = false
    try {
      const [setup] = await Promise.all([fetchSetupStatus(), fetchLoginOptions()])
      requiresSetup = setup
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

    if (to.path === '/register') {
      const { user } = useAuth()
      if (user.value) return { path: '/' }
      if (!loginOptions.value?.allowRegistration) return { path: '/login' }
    }

    if (PASSWORD_ONLY_PUBLIC_PATHS.has(to.path) && loginOptions.value?.passwordLoginEnabled !== true) {
      return { path: '/login' }
    }

    if (to.meta.public) return true

    const { user } = useAuth()

    if (!user.value) {
      return { path: '/login', query: { redirect: to.fullPath } }
    }

    if (
      user.value.isDefaultPassword &&
      user.value.provisioningMethod !== 'shared' &&
      user.value.authenticationMethod !== 'oidc' &&
      loginOptions.value?.passwordLoginEnabled !== false
    ) {
      useChangePasswordDialog().open(true)
      // Allow navigation to '/' but block everything else
      if (to.path !== '/') return { path: '/' }
    }

    const permissions = user.value.permissions ?? []
    if (to.meta.forbiddenPermission && permissions.includes(to.meta.forbiddenPermission)) {
      return permissionFallback(to.meta.permissionFallback)
    }

    if (to.meta.requiredPermission && !user.value.isSuperuser && !holdsRequired(to.meta.requiredPermission, permissions)) {
      return permissionFallback(to.meta.permissionFallback)
    }

    if (to.name === 'achievements' && user.value.settings.achievementPreferences?.enabled === false) {
      return { name: 'settings-account-profile' }
    }

    if (
      user.value.settings.showBookRequests === false &&
      (to.name === 'book-requests' ||
        to.name === 'book-request-detail' ||
        to.name === 'book-request-releases' ||
        to.name === 'settings-admin-requests')
    ) {
      return { name: 'settings-appearance-behavior' }
    }

    return true
  })
}
