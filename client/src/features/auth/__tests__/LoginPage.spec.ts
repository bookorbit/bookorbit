import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

import LoginPage from '../LoginPage.vue'

const { statusState, routeState } = vi.hoisted(() => ({
  statusState: { allowRegistration: false, passwordLoginEnabled: true },
  routeState: { query: {} as Record<string, unknown> },
}))

vi.mock('../composables/useAuth', () => ({
  LoginError: class LoginError extends Error {},
  useAuth: () => ({ login: vi.fn<() => void>() }),
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
      fetchLoginOptions: vi.fn<() => Promise<typeof options>>(async () => options),
    }
  },
}))

vi.mock('../composables/useSetupStatus', () => ({
  useSetupStatus: () => ({
    allowRegistration: ref(statusState.allowRegistration),
    setupStatusError: ref(null),
  }),
}))

vi.mock('vue-router', () => ({ useRoute: () => routeState }))

vi.mock('@/stores/theme', () => ({
  ACCENT_OPTIONS: [{ id: 'blue', color: '#00f', swatchClass: '', labelKey: 'common.close' }],
  ACCENT_ROWS: [],
  RADIUS_OPTIONS: [],
  BACKGROUND_OPTIONS: [],
  useThemeStore: () => ({
    accent: 'blue',
    radius: 'default',
    background: 'none',
    resolvedTheme: 'light',
    toggleTheme: vi.fn<() => void>(),
    setAccent: vi.fn<() => void>(),
    setRadius: vi.fn<() => void>(),
    setBackground: vi.fn<() => void>(),
  }),
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
  routeState.query = {}
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
