import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import { registerAuthGuard } from '../guards/auth.guard'

const { authState, statusState, openChangePasswordMock } = vi.hoisted(() => ({
  authState: { user: null as Record<string, unknown> | null },
  statusState: { needsSetup: false, allowRegistration: false, passwordLoginEnabled: true },
  openChangePasswordMock: vi.fn<(force: boolean) => void>(),
}))

vi.mock('@/features/auth/composables/useAuth', () => ({
  useAuth: () => ({ user: ref(authState.user) }),
}))

vi.mock('@/features/auth/composables/useSetupStatus', () => ({
  useSetupStatus: () => ({
    allowRegistration: ref(statusState.allowRegistration),
    fetchSetupStatus: vi.fn<() => Promise<boolean>>(async () => statusState.needsSetup),
  }),
}))

vi.mock('@/features/auth/composables/useLoginOptions', () => ({
  useLoginOptions: () => {
    const options = {
      passwordLoginEnabled: statusState.passwordLoginEnabled,
      allowRegistration: statusState.passwordLoginEnabled && statusState.allowRegistration,
      oidcProviders: [],
    }
    return {
      loginOptions: ref(options),
      fetchLoginOptions: vi.fn<() => Promise<typeof options>>(async () => options),
    }
  },
}))

vi.mock('@/composables/useChangePasswordDialog', () => ({
  useChangePasswordDialog: () => ({ open: openChangePasswordMock }),
}))

const blank = { template: '<div />' }

function makeRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: blank },
      { path: '/login', name: 'login', component: blank, meta: { public: true } },
      { path: '/register', name: 'register', component: blank, meta: { public: true } },
      { path: '/setup', name: 'setup', component: blank, meta: { public: true } },
      { path: '/forgot-password', name: 'forgot-password', component: blank, meta: { public: true } },
      { path: '/reset-password', name: 'reset-password', component: blank, meta: { public: true } },
    ],
  })
  registerAuthGuard(router)
  return router
}

beforeEach(() => {
  vi.clearAllMocks()
  authState.user = null
  statusState.needsSetup = false
  statusState.allowRegistration = false
  statusState.passwordLoginEnabled = true
})

describe('auth guard: /register', () => {
  it('redirects a visitor to /login when self-registration is closed', async () => {
    const router = makeRouter()

    await router.push('/register')

    expect(router.currentRoute.value.path).toBe('/login')
  })

  it('allows a visitor through when self-registration is open', async () => {
    statusState.allowRegistration = true
    const router = makeRouter()

    await router.push('/register')

    expect(router.currentRoute.value.path).toBe('/register')
  })

  it('sends a signed-in user home instead of the sign-up page', async () => {
    statusState.allowRegistration = true
    authState.user = { id: 1, isDefaultPassword: false, settings: {} }
    const router = makeRouter()

    await router.push('/register')

    expect(router.currentRoute.value.path).toBe('/')
  })

  it('redirects a visitor to /login when password authentication is disabled', async () => {
    statusState.allowRegistration = true
    statusState.passwordLoginEnabled = false
    const router = makeRouter()

    await router.push('/register')

    expect(router.currentRoute.value.path).toBe('/login')
  })

  it('sends a signed-in user home even when registration is closed', async () => {
    authState.user = { id: 1, isDefaultPassword: false, settings: {} }
    const router = makeRouter()

    await router.push('/register')

    expect(router.currentRoute.value.path).toBe('/')
  })

  it('still forces initial setup ahead of the sign-up page', async () => {
    statusState.needsSetup = true
    statusState.allowRegistration = true
    const router = makeRouter()

    await router.push('/register')

    expect(router.currentRoute.value.path).toBe('/setup')
  })
})

describe('auth guard: password recovery', () => {
  it.each(['/forgot-password', '/reset-password?token=existing-token'])('redirects %s when password authentication is disabled', async (path) => {
    statusState.passwordLoginEnabled = false
    const router = makeRouter()

    await router.push(path)

    expect(router.currentRoute.value.path).toBe('/login')
  })

  it.each(['/forgot-password', '/reset-password?token=existing-token'])('allows %s when password authentication is enabled', async (path) => {
    const router = makeRouter()

    await router.push(path)

    expect(router.currentRoute.value.fullPath).toBe(path)
  })
})
