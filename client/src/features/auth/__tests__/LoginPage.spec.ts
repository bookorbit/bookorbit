import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

import { LoginErrorCode } from '@bookorbit/types'
import LoginPage from '../LoginPage.vue'
import { LoginError } from '../composables/useAuth'

const { statusState, routeState, loginMock } = vi.hoisted(() => ({
  statusState: { allowRegistration: false, passwordLoginEnabled: true, optionsFail: false },
  routeState: { query: {} as Record<string, unknown> },
  loginMock: vi.fn<(username: string, password: string) => Promise<void>>(),
}))

// Same constructor as the real LoginError; importing the real module pulls in the router.
vi.mock('../composables/useAuth', () => ({
  LoginError: class LoginError extends Error {
    constructor(
      public readonly errorCode: string | undefined,
      public readonly retryAfterSeconds: number | undefined,
      message: string,
    ) {
      super(message)
    }
  },
  useAuth: () => ({ login: loginMock }),
}))

vi.mock('../composables/useOidc', () => ({
  useOidc: () => ({ initiateLogin: vi.fn<() => void>() }),
}))

vi.mock('../composables/useLoginOptions', () => ({
  useLoginOptions: () => {
    const options = {
      passwordLoginEnabled: statusState.passwordLoginEnabled,
      allowRegistration: statusState.passwordLoginEnabled && statusState.allowRegistration,
      oidcProviders: [],
    }
    return {
      loginOptions: ref(options),
      loginOptionsError: ref(null),
      fetchLoginOptions: vi.fn<() => Promise<typeof options>>(async () => {
        if (statusState.optionsFail) throw new Error('Failed to load sign-in options')
        return options
      }),
    }
  },
}))

vi.mock('../composables/useSetupStatus', () => ({
  useSetupStatus: () => ({
    allowRegistration: ref(statusState.allowRegistration),
    setupStatusError: ref(null),
    fetchSetupStatus: vi.fn<() => Promise<boolean>>(async () => false),
  }),
}))

vi.mock('vue-router', () => ({ useRoute: () => routeState }))

vi.mock('../components/AuthAppearanceToolbar.vue', () => ({
  default: { name: 'AuthAppearanceToolbar', template: '<div data-testid="auth-appearance-toolbar" />' },
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: { template: '<div><slot /></div>' },
  TooltipContent: { template: '<div><slot /></div>' },
  TooltipTrigger: { template: '<div><slot /></div>' },
}))

function mountPage() {
  return mount(LoginPage, {
    global: { stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  statusState.allowRegistration = false
  statusState.passwordLoginEnabled = true
  statusState.optionsFail = false
  routeState.query = {}
  loginMock.mockResolvedValue(undefined)
})

describe('LoginPage sign-up affordance', () => {
  it('offers a link to the sign-up page when self-registration is open', async () => {
    statusState.allowRegistration = true
    const wrapper = mountPage()
    await flushPromises()

    const link = wrapper.findAll('a').find((a) => a.attributes('href') === '/register')
    expect(link).toBeDefined()
    expect(link?.text()).toBe('Sign up')
  })

  it('hides the sign-up link when self-registration is closed', async () => {
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.findAll('a').some((a) => a.attributes('href') === '/register')).toBe(false)
    expect(wrapper.text()).not.toContain('Sign up')
  })

  it('keeps the forgot-password link regardless of registration state', async () => {
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.findAll('a').some((a) => a.attributes('href') === '/forgot-password')).toBe(true)
  })

  it('omits every password affordance when password authentication is disabled', async () => {
    statusState.passwordLoginEnabled = false
    statusState.allowRegistration = true
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.findAll('a').some((a) => ['/register', '/forgot-password'].includes(a.attributes('href') ?? ''))).toBe(false)
  })
})

describe('LoginPage post-registration notice', () => {
  it('confirms the new account and explains the permission gap', async () => {
    routeState.query = { registered: '1' }
    const wrapper = mountPage()
    await flushPromises()

    const notice = wrapper.find('[role="status"]')
    expect(notice.exists()).toBe(true)
    expect(notice.text()).toContain('Account created')
    expect(notice.text()).toContain('An administrator needs to grant permissions')
  })

  it('shows no notice on a normal visit', async () => {
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })

  it('ignores an unexpected registered value', async () => {
    routeState.query = { registered: 'yes' }
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })
})

describe('LoginPage messages', () => {
  it('confirms a password reset', async () => {
    routeState.query = { reset: '1' }
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.find('[role="status"]').text()).toContain('Password updated')
  })

  it('reports a failed options load with a retry even when password sign-in is off', async () => {
    statusState.passwordLoginEnabled = false
    statusState.optionsFail = true
    const wrapper = mountPage()
    await flushPromises()

    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toContain('Sign-in options could not be loaded')

    statusState.optionsFail = false
    await alert.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('offers a password reset when the account is locked', async () => {
    loginMock.mockRejectedValue(new LoginError(LoginErrorCode.ACCOUNT_LOCKED, 900, 'Account locked'))
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toContain('15 minutes')
    const reset = alert.findAll('a').find((a) => a.attributes('href') === '/forgot-password')
    expect(reset?.text()).toBe('Reset password')
  })

  it('marks the password field invalid after rejected credentials', async () => {
    loginMock.mockRejectedValue(new Error('Invalid credentials'))
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toBe('Invalid username or password')
    expect(wrapper.get('#password').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('#password').attributes('aria-describedby')).toContain('login-error')
  })
})
