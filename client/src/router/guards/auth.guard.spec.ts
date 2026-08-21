import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, type Ref } from 'vue'
import { Permission } from '@bookorbit/types'

import { registerAuthGuard } from './auth.guard'

const mocks = vi.hoisted(() => ({
  fetchSetupStatus: vi.fn<() => Promise<boolean>>(),
  openChangePassword: vi.fn<(required: boolean) => void>(),
  user: null as unknown as Ref<{
    isDefaultPassword: boolean
    isSuperuser: boolean
    permissions: string[]
    provisioningMethod: string
    settings: { achievementPreferences: { enabled: boolean } }
  }>,
}))

vi.mock('@/features/auth/composables/useAuth', () => ({
  useAuth: () => ({ user: mocks.user }),
}))

vi.mock('@/composables/useChangePasswordDialog', () => ({
  useChangePasswordDialog: () => ({ open: mocks.openChangePassword }),
}))

vi.mock('@/features/auth/composables/useSetupStatus', () => ({
  useSetupStatus: () => ({ fetchSetupStatus: mocks.fetchSetupStatus }),
}))

describe('registerAuthGuard', () => {
  type TestRoute = {
    name: string
    path: string
    fullPath: string
    meta: Record<string, unknown>
  }
  let guard: ((to: TestRoute) => Promise<unknown>) | null = null

  beforeEach(() => {
    mocks.fetchSetupStatus.mockReset()
    mocks.fetchSetupStatus.mockResolvedValue(false)
    mocks.openChangePassword.mockReset()
    mocks.user = ref({
      isDefaultPassword: false,
      isSuperuser: false,
      permissions: [],
      provisioningMethod: 'local',
      settings: { achievementPreferences: { enabled: false } },
    })
    registerAuthGuard({
      beforeEach: vi.fn<(callback: (to: TestRoute) => Promise<unknown>) => void>((callback) => {
        guard = callback
      }),
    } as never)
  })

  it('redirects disabled achievement routes to Account profile settings', async () => {
    if (!guard) throw new Error('Expected guard to be registered')

    await expect(guard({ name: 'achievements', path: '/achievements', fullPath: '/achievements', meta: {} })).resolves.toEqual({
      name: 'settings-account-profile',
    })
  })

  it('allows achievement routes when achievements are enabled', async () => {
    mocks.user.value.settings.achievementPreferences.enabled = true
    if (!guard) throw new Error('Expected guard to be registered')

    await expect(guard({ name: 'achievements', path: '/achievements', fullPath: '/achievements', meta: {} })).resolves.toBe(true)
  })

  it('redirects a direct route visit when the required permission is missing', async () => {
    if (!guard) throw new Error('Expected guard to be registered')

    await expect(
      guard({
        name: 'settings-notifications',
        path: '/settings/account/notifications',
        fullPath: '/settings/account/notifications',
        meta: {
          requiredPermission: Permission.NotificationAccess,
          forbiddenPermission: Permission.DemoRestricted,
          permissionFallback: 'settings-account-profile',
        },
      }),
    ).resolves.toEqual({ name: 'settings-account-profile' })
  })

  it('allows a direct route visit with notification access or superuser status', async () => {
    if (!guard) throw new Error('Expected guard to be registered')
    const route = {
      name: 'settings-notifications',
      path: '/settings/account/notifications',
      fullPath: '/settings/account/notifications',
      meta: { requiredPermission: Permission.NotificationAccess },
    }

    mocks.user.value.permissions = [Permission.NotificationAccess]
    await expect(guard(route)).resolves.toBe(true)

    mocks.user.value.permissions = []
    mocks.user.value.isSuperuser = true
    await expect(guard(route)).resolves.toBe(true)
  })

  it('redirects demo-restricted users even when notification access would otherwise allow the route', async () => {
    if (!guard) throw new Error('Expected guard to be registered')
    mocks.user.value.isSuperuser = true
    mocks.user.value.permissions = [Permission.NotificationAccess, Permission.DemoRestricted]

    await expect(
      guard({
        name: 'settings-notifications',
        path: '/settings/account/notifications',
        fullPath: '/settings/account/notifications',
        meta: {
          requiredPermission: Permission.NotificationAccess,
          forbiddenPermission: Permission.DemoRestricted,
          permissionFallback: 'settings-account-profile',
        },
      }),
    ).resolves.toEqual({ name: 'settings-account-profile' })
  })
})
