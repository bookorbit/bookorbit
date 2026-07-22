import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ShelfmarkSettings from '../ShelfmarkSettings.vue'

const state = vi.hoisted(() => ({ canManageAppSettings: false }))
const apiMock = vi.hoisted(() => vi.fn<(url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>>())
const setShelfmarkEnabledMock = vi.hoisted(() => vi.fn<(enabled: boolean) => void>())
const toastMock = vi.hoisted(() => ({ success: vi.fn<(message: string) => void>(), error: vi.fn<(message: string) => void>() }))

vi.mock('@/lib/api', () => ({ api: apiMock }))
vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => state.canManageAppSettings }),
}))
vi.mock('@/features/book/composables/useGlobalSearch', () => ({
  setShelfmarkEnabled: setShelfmarkEnabledMock,
}))
vi.mock('vue-sonner', () => ({ toast: toastMock }))
vi.mock('../SettingsPageHeader.vue', () => ({ default: { template: '<div />' } }))

function response(ok: boolean, body: unknown = {}) {
  return { ok, status: ok ? 200 : 400, json: async () => body }
}

describe('ShelfmarkSettings', () => {
  beforeEach(() => {
    state.canManageAppSettings = false
    apiMock.mockReset()
    setShelfmarkEnabledMock.mockReset()
    toastMock.success.mockReset()
    toastMock.error.mockReset()
    apiMock.mockResolvedValue(
      response(true, {
        settings: { enabled: true, url: 'http://localhost:8080', externalUrl: 'https://shelfmark.example.com' },
      }),
    )
  })

  it('associates URL labels and hides connection testing without permission', async () => {
    const wrapper = mount(ShelfmarkSettings)
    await flushPromises()

    expect(wrapper.get('label[for="shelfmark-url"]').text()).toBe('Shelfmark URL')
    expect(wrapper.get('#shelfmark-url').attributes('type')).toBe('url')
    expect(wrapper.get('label[for="shelfmark-external-url"]').text()).toContain('External URL')
    expect(wrapper.findAll('button').some((button) => button.text().includes('Test Connection'))).toBe(false)
  })

  it('shows connection testing to users with app-settings permission', async () => {
    state.canManageAppSettings = true
    const wrapper = mount(ShelfmarkSettings)
    await flushPromises()

    expect(wrapper.findAll('button').some((button) => button.text().includes('Test Connection'))).toBe(true)
  })

  it('updates the shared search state after saving', async () => {
    const wrapper = mount(ShelfmarkSettings)
    await flushPromises()
    apiMock.mockResolvedValueOnce(response(true))

    const saveButton = wrapper.findAll('button').find((button) => button.text() === 'Save Settings')
    expect(saveButton).toBeDefined()
    await saveButton!.trigger('click')
    await flushPromises()

    expect(apiMock).toHaveBeenLastCalledWith(
      '/api/v1/user-preferences/shelfmark',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          settings: {
            enabled: true,
            url: 'http://localhost:8080',
            externalUrl: 'https://shelfmark.example.com',
          },
        }),
      }),
    )
    expect(setShelfmarkEnabledMock).toHaveBeenCalledWith(true)
    expect(toastMock.success).toHaveBeenCalledWith('Shelfmark settings saved')
  })
})
