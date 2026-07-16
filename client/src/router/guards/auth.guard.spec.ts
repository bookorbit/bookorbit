import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, type Ref } from 'vue'

import { registerAuthGuard } from './auth.guard'

const mocks = vi.hoisted(() => ({
  fetchSetupStatus: vi.fn<() => Promise<boolean>>(),
  openChangePassword: vi.fn<(required: boolean) => void>(),
  user: null as unknown as Ref<{
    isDefaultPassword: boolean
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
      name: 'settings-account',
      query: { tab: 'profile' },
    })
  })

  it('allows achievement routes when achievements are enabled', async () => {
    mocks.user.value.settings.achievementPreferences.enabled = true
    if (!guard) throw new Error('Expected guard to be registered')

    await expect(guard({ name: 'achievements', path: '/achievements', fullPath: '/achievements', meta: {} })).resolves.toBe(true)
  })
})
