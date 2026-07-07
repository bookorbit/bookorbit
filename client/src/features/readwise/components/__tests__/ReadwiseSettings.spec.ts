import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import type { ReadwiseSettings } from '@bookorbit/types'
import ReadwiseSettingsPage from '../ReadwiseSettings.vue'

const settings = ref<ReadwiseSettings | null>(null)
const error = ref<string | null>(null)

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn<() => void>(), error: vi.fn<() => void>() } }))

vi.mock('../../composables/useReadwiseSettings', () => ({
  useReadwiseSettings: () => ({
    settings,
    loading: ref(false),
    saving: ref(false),
    validating: ref(false),
    error,
    fetchSettings: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    saveSettings: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    validateToken: vi.fn<() => Promise<{ valid: boolean }>>().mockResolvedValue({ valid: true }),
  }),
}))

beforeEach(() => {
  settings.value = null
  error.value = null
})

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
    expect(wrapper.text()).toContain('Your Readwise token was rejected — paste a new one and re-enable.')
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
    settings.value = null
    error.value = 'Failed to load settings'
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('Failed to load settings')
  })

  it('does not show an error banner when there is no error', async () => {
    settings.value = baseSettings()
    error.value = null
    const wrapper = await mountPage()
    expect(wrapper.text()).not.toContain('Failed to load settings')
  })
})
