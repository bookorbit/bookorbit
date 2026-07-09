import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import type { StorygraphSettings, UpsertStorygraphSettingsPayload } from '@bookorbit/types'
import StorygraphConnectionCard from '../StorygraphConnectionCard.vue'

const settings = ref<StorygraphSettings | null>(null)
const loading = ref(false)
const saving = ref(false)
const validating = ref(false)
const error = ref<string | null>(null)

const mocks = vi.hoisted(() => ({
  fetchSettings: vi.fn<() => Promise<void>>(),
  saveSettings: vi.fn<(payload: UpsertStorygraphSettingsPayload) => Promise<boolean>>(),
  disconnect: vi.fn<() => Promise<void>>(),
  validateCookies: vi.fn<(sessionCookie?: string, rememberToken?: string) => Promise<{ valid: boolean }>>(),
}))

const toastSuccess = vi.hoisted(() => vi.fn<(message: string) => void>())
const toastError = vi.hoisted(() => vi.fn<(message: string) => void>())

vi.mock('../../composables/useStorygraphSettings', () => ({
  useStorygraphSettings: () => ({
    settings,
    loading,
    saving,
    validating,
    error,
    fetchSettings: mocks.fetchSettings,
    saveSettings: mocks.saveSettings,
    disconnect: mocks.disconnect,
    validateCookies: mocks.validateCookies,
  }),
}))

vi.mock('vue-sonner', () => ({
  toast: {
    success: toastSuccess,
    error: toastError,
  },
}))

function makeSettings(overrides: Partial<StorygraphSettings> = {}): StorygraphSettings {
  return {
    cookiesConfigured: true,
    enabled: true,
    effectiveEnabled: true,
    disabledReason: null,
    bookSyncMode: 'all_eligible',
    autoSyncOnStatusChange: true,
    autoSyncOnProgressUpdate: true,
    lastSyncedAt: null,
    ...overrides,
  }
}

function findButton(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper.findAll('button').find((b) => b.text().includes(label))
}

function hasValidationBadge(wrapper: ReturnType<typeof mount>): boolean {
  return wrapper.findAll('span').some((s) => s.text().trim() === 'Valid' || s.text().includes('Invalid or expired'))
}

function cookieInputs(wrapper: ReturnType<typeof mount>) {
  const session = wrapper.find('input[placeholder="Paste the _storygraph_session cookie value"]')
  const remember = wrapper.find('input[placeholder="Paste the remember_user_token cookie value"]')
  return { session, remember }
}

describe('StorygraphConnectionCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    settings.value = makeSettings()
    loading.value = false
    saving.value = false
    validating.value = false
    error.value = null
    mocks.saveSettings.mockResolvedValue(true)
    mocks.disconnect.mockResolvedValue()
    mocks.validateCookies.mockResolvedValue({ valid: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the connected state with sync option toggles', async () => {
    const wrapper = mount(StorygraphConnectionCard)
    await flushPromises()

    expect(wrapper.text()).toContain('Connected')
    expect(wrapper.text()).toContain('Enable sync')
    expect(wrapper.text()).toContain('Sync on status change')
    expect(wrapper.text()).toContain('Sync on progress update')
    expect(mocks.fetchSettings).toHaveBeenCalled()
  })

  it('validates cookies and shows the result badge', async () => {
    const wrapper = mount(StorygraphConnectionCard)
    await flushPromises()

    const { session, remember } = cookieInputs(wrapper)
    await session.setValue('sess-value')
    await remember.setValue('remember-value')
    await findButton(wrapper, 'Validate cookies')!.trigger('click')
    await flushPromises()

    expect(mocks.validateCookies).toHaveBeenCalledWith('sess-value', 'remember-value')
    expect(hasValidationBadge(wrapper)).toBe(true)
  })

  it('clears a stale validation badge when a cookie input changes', async () => {
    const wrapper = mount(StorygraphConnectionCard)
    await flushPromises()

    const { session, remember } = cookieInputs(wrapper)
    await session.setValue('sess-value')
    await remember.setValue('remember-value')
    await findButton(wrapper, 'Validate cookies')!.trigger('click')
    await flushPromises()
    expect(hasValidationBadge(wrapper)).toBe(true)

    await session.setValue('sess-value-edited')
    await flushPromises()

    expect(hasValidationBadge(wrapper)).toBe(false)
  })

  it('saves new cookies together with the sync options', async () => {
    const wrapper = mount(StorygraphConnectionCard)
    await flushPromises()

    const { session, remember } = cookieInputs(wrapper)
    await session.setValue('new-sess')
    await remember.setValue('new-remember')
    await findButton(wrapper, 'Save')!.trigger('click')
    await flushPromises()

    expect(mocks.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ sessionCookie: 'new-sess', rememberToken: 'new-remember' }))
    expect(toastSuccess).toHaveBeenCalled()
  })

  it('rejects a save when only one cookie value is entered instead of silently dropping it', async () => {
    const wrapper = mount(StorygraphConnectionCard)
    await flushPromises()

    const { session } = cookieInputs(wrapper)
    await session.setValue('only-one-cookie')
    await findButton(wrapper, 'Save')!.trigger('click')
    await flushPromises()

    expect(mocks.saveSettings).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith('Enter both cookie values to update the connection')
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('saves toggles without cookie fields when the inputs are empty', async () => {
    const wrapper = mount(StorygraphConnectionCard)
    await flushPromises()

    await findButton(wrapper, 'Save')!.trigger('click')
    await flushPromises()

    expect(mocks.saveSettings).toHaveBeenCalledTimes(1)
    const payload = mocks.saveSettings.mock.calls[0]![0]
    expect(payload).not.toHaveProperty('sessionCookie')
    expect(payload).not.toHaveProperty('rememberToken')
  })

  it('disconnects and clears the inputs', async () => {
    const wrapper = mount(StorygraphConnectionCard)
    await flushPromises()

    await findButton(wrapper, 'Disconnect')!.trigger('click')
    await flushPromises()

    expect(mocks.disconnect).toHaveBeenCalled()
    expect(toastSuccess).toHaveBeenCalledWith('StoryGraph disconnected')
  })
})
