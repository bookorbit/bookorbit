import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import KoreaderSettings from '../KoreaderSettings.vue'

const koreaderState = vi.hoisted(() => {
  const updateCredentials = vi.fn<(...args: unknown[]) => Promise<void>>()
  const credentials = {
    username: 'reader-user',
    syncEnabled: true,
    discardBackwardProgress: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
  return {
    credentials: {
      __v_isRef: true,
      value: credentials,
    },
    syncStatus: {
      __v_isRef: true,
      value: {
        credentials,
        devices: [],
        totalSyncedBooks: 0,
        lastSyncAt: null,
      },
    },
    loading: { __v_isRef: true, value: false },
    fetchSyncStatus: vi.fn<() => Promise<void>>(),
    createCredentials: vi.fn<() => Promise<void>>(),
    updateCredentials,
    deleteCredentials: vi.fn<() => Promise<void>>(),
    getSyncUrl: vi.fn<() => string>(() => 'https://bookorbit.example/api/v1/koreader'),
  }
})

vi.mock('@/features/koreader/composables/useKoreaderSync', () => ({
  useKoreaderSync: () => koreaderState,
}))

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn<() => void>(), error: vi.fn<() => void>() },
}))

vi.mock('../SettingsPageHeader.vue', () => ({
  default: { template: '<div />' },
}))

function mountComponent() {
  return mount(KoreaderSettings, { props: { embedded: true } })
}

describe('KoreaderSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    koreaderState.credentials.value = {
      username: 'reader-user',
      syncEnabled: true,
      discardBackwardProgress: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    }
    koreaderState.syncStatus.value = {
      credentials: koreaderState.credentials.value,
      devices: [],
      totalSyncedBooks: 0,
      lastSyncAt: null,
    }
    koreaderState.loading.value = false
    koreaderState.fetchSyncStatus.mockResolvedValue(undefined)
    koreaderState.updateCredentials.mockResolvedValue(undefined)
  })

  it('shows the backward progress toggle and sends the discardBackwardProgress PATCH', async () => {
    const wrapper = mountComponent()
    await flushPromises()

    expect(wrapper.text()).toContain('Ignore older progress updates')
    expect(wrapper.text()).toContain('When enabled, KOReader sync updates that would move reading progress backwards are ignored.')

    const switches = wrapper.findAll('[role="switch"]')
    await switches[1]!.trigger('click')
    await flushPromises()

    expect(koreaderState.updateCredentials).toHaveBeenCalledWith({ discardBackwardProgress: true })
  })
})
