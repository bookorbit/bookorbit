import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import RegisterPage from '../RegisterPage.vue'
import { RegisterError } from '../composables/useAuth'

const { registerMock } = vi.hoisted(() => ({
  registerMock: vi.fn<(payload: Record<string, string>) => Promise<void>>(),
}))

vi.mock('../composables/useAuth', async () => {
  const actual = await vi.importActual<typeof import('../composables/useAuth')>('../composables/useAuth')
  return { RegisterError: actual.RegisterError, useAuth: () => ({ register: registerMock }) }
})

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
  return mount(RegisterPage, {
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  })
}

async function fillForm(wrapper: ReturnType<typeof mountPage>, overrides: Partial<Record<string, string>> = {}) {
  await wrapper.find('#register-username').setValue(overrides.username ?? 'ada')
  await wrapper.find('#register-name').setValue(overrides.name ?? 'Ada Lovelace')
  await wrapper.find('#register-email').setValue(overrides.email ?? 'ada@example.com')
  await wrapper.find('#register-password').setValue(overrides.password ?? 'Passw0rd')
  await wrapper.find('#register-confirm-password').setValue(overrides.confirmPassword ?? 'Passw0rd')
}

function alertText(wrapper: ReturnType<typeof mountPage>): string {
  return wrapper.find('[role="alert"]').text()
}

beforeEach(() => {
  vi.clearAllMocks()
  registerMock.mockResolvedValue(undefined)
})

describe('RegisterPage', () => {
  it('submits the entered account details', async () => {
    const wrapper = mountPage()
    await fillForm(wrapper)

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(registerMock).toHaveBeenCalledWith({
      username: 'ada',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'Passw0rd',
    })
  })

  it('does not submit when the passwords do not match', async () => {
    const wrapper = mountPage()
    await fillForm(wrapper, { confirmPassword: 'Different1' })

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(registerMock).not.toHaveBeenCalled()
    expect(alertText(wrapper)).toBe('Passwords do not match')
  })

  it('rejects a spoofing username before it reaches the server', async () => {
    const wrapper = mountPage()
    await fillForm(wrapper, { username: 'adm\u202Ein' })

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(registerMock).not.toHaveBeenCalled()
    expect(alertText(wrapper)).toBe('Your username cannot contain hidden or text-direction characters.')
  })

  it('rejects a padded username before it reaches the server', async () => {
    const wrapper = mountPage()
    await fillForm(wrapper, { username: ' admin' })

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(registerMock).not.toHaveBeenCalled()
    expect(alertText(wrapper)).toBe('Your username cannot start or end with a space.')
  })

  it('rejects a spoofing display name before it reaches the server', async () => {
    const wrapper = mountPage()
    await fillForm(wrapper, { name: 'Ada\u200BLovelace' })

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(registerMock).not.toHaveBeenCalled()
    expect(alertText(wrapper)).toBe('Your name cannot contain hidden or text-direction characters.')
  })

  it('accepts a non-Latin username', async () => {
    const wrapper = mountPage()
    await fillForm(wrapper, { username: '夏目漱石', name: 'José García' })

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(registerMock).toHaveBeenCalledWith(expect.objectContaining({ username: '夏目漱石', name: 'José García' }))
  })

  it('explains that registration is closed on a 403', async () => {
    registerMock.mockRejectedValue(new RegisterError(403, 'Registration is not open'))
    const wrapper = mountPage()
    await fillForm(wrapper)

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(alertText(wrapper)).toBe('Self-registration is not open on this server.')
  })

  it('reports a taken username or email on a 409', async () => {
    registerMock.mockRejectedValue(new RegisterError(409, 'Registration failed'))
    const wrapper = mountPage()
    await fillForm(wrapper)

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(alertText(wrapper)).toBe('That username or email is already in use.')
  })

  it('reports throttling on a 429', async () => {
    registerMock.mockRejectedValue(new RegisterError(429, 'Too Many Requests'))
    const wrapper = mountPage()
    await fillForm(wrapper)

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(alertText(wrapper)).toBe('Too many attempts. Please wait a minute and try again.')
  })

  it('falls back to a generic message for unexpected failures', async () => {
    registerMock.mockRejectedValue(new Error('boom'))
    const wrapper = mountPage()
    await fillForm(wrapper)

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(alertText(wrapper)).toBe('Failed to create account')
  })

  it('re-enables the submit button after a failure', async () => {
    registerMock.mockRejectedValue(new RegisterError(409, 'Registration failed'))
    const wrapper = mountPage()
    await fillForm(wrapper)

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeUndefined()
  })
})
