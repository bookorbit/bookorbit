import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import type { ReadwiseSettings } from '@bookorbit/types'
import ReadwiseSettingsPage from '../ReadwiseSettings.vue'

const settings = ref<ReadwiseSettings | null>(null)
const error = ref<string | null>(null)

const { fetchSettings, saveSettings, validateToken, toastSuccess, toastError } = vi.hoisted(() => ({
  fetchSettings: vi.fn<() => Promise<void>>(),
  saveSettings: vi.fn<(payload: unknown) => Promise<boolean>>(),
  validateToken: vi.fn<(token?: string) => Promise<{ valid: boolean }>>(),
  toastSuccess: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(message: string) => void>(),
}))

vi.mock('vue-sonner', () => ({ toast: { success: toastSuccess, error: toastError } }))

vi.mock('../../composables/useReadwiseSettings', () => ({
  useReadwiseSettings: () => ({
    settings,
    loading: ref(false),
    saving: ref(false),
    validating: ref(false),
    error,
    fetchSettings,
    saveSettings,
    validateToken,
  }),
}))

beforeEach(() => {
  settings.value = null
  error.value = null
  fetchSettings.mockReset().mockResolvedValue(undefined)
  saveSettings.mockReset().mockResolvedValue(true)
  validateToken.mockReset().mockResolvedValue({ valid: true })
  toastSuccess.mockReset()
  toastError.mockReset()
})

function testButton(wrapper: Awaited<ReturnType<typeof mountPage>>, label: string) {
  const btn = wrapper.findAll('button').find((b) => b.text().trim() === label)
  if (!btn) throw new Error(`button "${label}" not found`)
  return btn
}

function baseSettings(overrides: Partial<ReadwiseSettings> = {}): ReadwiseSettings {
  return {
    tokenConfigured: false,
    enabled: false,
    effectiveEnabled: false,
    disabledReason: null,
    lastSyncedAt: null,
    ...overrides,
  }
}

async function mountPage() {
  const wrapper = mount(ReadwiseSettingsPage)
  await flushPromises()
  return wrapper
}

describe('ReadwiseSettings', () => {
  it('renders the invalid_token disabledReason banner message', async () => {
    settings.value = baseSettings({ disabledReason: 'invalid_token' })
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('Your Readwise token was rejected. Paste a new one and re-enable.')
  })

  it('renders the missing_token disabledReason banner message', async () => {
    settings.value = baseSettings({ disabledReason: 'missing_token' })
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('Add your Readwise access token to start syncing.')
  })

  it('does not render a banner when disabledReason is null', async () => {
    settings.value = baseSettings({ disabledReason: null })
    const wrapper = await mountPage()
    expect(wrapper.text()).not.toContain('Add your Readwise access token to start syncing.')
  })

  it('shows the Connected indicator when a token is configured', async () => {
    settings.value = baseSettings({ tokenConfigured: true })
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('Connected')
  })

  it('surfaces a fetch error when loading settings fails', async () => {
    fetchSettings.mockImplementationOnce(async () => {
      error.value = 'Failed to load settings'
    })
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('Failed to load settings')
  })

  it('does not show an error banner when there is no error', async () => {
    settings.value = baseSettings()
    const wrapper = await mountPage()
    expect(wrapper.text()).not.toContain('Failed to load settings')
  })

  it('rejects the Test action with an empty token when no token is saved', async () => {
    settings.value = baseSettings()
    const wrapper = await mountPage()

    await testButton(wrapper, 'Test').trigger('click')
    await flushPromises()

    expect(validateToken).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith('Enter your Readwise access token first')
  })

  it('validates a trimmed token and shows the valid result', async () => {
    settings.value = baseSettings()
    const wrapper = await mountPage()

    await wrapper.get('#readwise-access-token').setValue('  my-token  ')
    await testButton(wrapper, 'Test').trigger('click')
    await flushPromises()

    expect(validateToken).toHaveBeenCalledWith('my-token')
    expect(wrapper.text()).toContain('Valid token')
  })

  it('validates the saved token when the token input is empty', async () => {
    settings.value = baseSettings({ tokenConfigured: true })
    const wrapper = await mountPage()

    await testButton(wrapper, 'Test').trigger('click')
    await flushPromises()

    expect(validateToken).toHaveBeenCalledWith(undefined)
    expect(toastError).not.toHaveBeenCalled()
  })

  it('shows an invalid result when the token is rejected', async () => {
    settings.value = baseSettings()
    validateToken.mockResolvedValue({ valid: false })
    const wrapper = await mountPage()

    await wrapper.get('#readwise-access-token').setValue('bad-token')
    await testButton(wrapper, 'Test').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Invalid token')
  })

  it('saves the trimmed token and enabled flag, then clears the token field', async () => {
    settings.value = baseSettings({ enabled: true })
    const wrapper = await mountPage()

    await wrapper.get('#readwise-access-token').setValue('  tok-123  ')
    await testButton(wrapper, 'Save').trigger('click')
    await flushPromises()

    expect(saveSettings).toHaveBeenCalledWith({ apiToken: 'tok-123', enabled: true })
    expect(toastSuccess).toHaveBeenCalledWith('Readwise settings saved')
    expect((wrapper.get('#readwise-access-token').element as HTMLInputElement).value).toBe('')
  })

  it('shows an error toast when saving fails', async () => {
    settings.value = baseSettings()
    saveSettings.mockResolvedValue(false)
    error.value = 'Something broke'
    const wrapper = await mountPage()

    await testButton(wrapper, 'Save').trigger('click')
    await flushPromises()

    expect(toastError).toHaveBeenCalledWith('Something broke')
  })

  it('toggles the token field between hidden and visible', async () => {
    settings.value = baseSettings()
    const wrapper = await mountPage()
    const input = wrapper.get('#readwise-access-token')

    expect((input.element as HTMLInputElement).type).toBe('password')
    await testButton(wrapper, 'Show').trigger('click')
    expect((input.element as HTMLInputElement).type).toBe('text')
    await testButton(wrapper, 'Hide').trigger('click')
    expect((input.element as HTMLInputElement).type).toBe('password')
  })
})
