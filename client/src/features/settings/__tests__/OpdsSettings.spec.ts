import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiMock, toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  apiMock: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
  toastErrorMock: vi.fn<(message: string) => void>(),
  toastSuccessMock: vi.fn<(message: string) => void>(),
}))

vi.mock('@/lib/api', () => ({ api: apiMock }))
vi.mock('@/lib/clipboard', () => ({ copyToClipboard: vi.fn<() => Promise<boolean>>().mockResolvedValue(true) }))
vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => true }),
}))
vi.mock('@vueuse/core', () => ({ useMediaQuery: () => ref(false) }))
vi.mock('vue-sonner', () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}))
vi.mock('@/components/ui/button', () => ({
  Button: { template: '<button><slot /></button>' },
}))
vi.mock('@/components/ui/ToggleSwitch.vue', () => ({
  default: { template: '<button />' },
}))

import OpdsSettings from '../OpdsSettings.vue'

function response(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 400,
    json: vi.fn<() => Promise<unknown>>().mockResolvedValue(body),
  } as unknown as Response
}

async function mountSettings() {
  const wrapper = mount(OpdsSettings)
  await flushPromises()
  return wrapper
}

describe('OpdsSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/app-settings') return response([{ key: 'opds_enabled', value: 'true' }])
      if (url === '/api/v1/opds-users') return response([{ id: 1, userId: 5, username: 'reader', sortOrder: 'recent', pageSize: 50 }])
      if (url === '/api/v1/opds-users/1' && init?.method === 'PATCH') {
        return response({ id: 1, userId: 5, username: 'reader', sortOrder: 'recent', pageSize: JSON.parse(String(init.body)).pageSize })
      }
      return response({})
    })
  })

  it('loads and labels the account page size', async () => {
    const wrapper = await mountSettings()
    const input = wrapper.get('#opds-page-size-1')

    expect(input.element).toHaveProperty('value', '50')
    expect(input.attributes('aria-label')).toBe('Books per page: reader')
  })

  it('disables both account settings while a save is pending', async () => {
    let resolvePatch!: (value: Response) => void
    apiMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/app-settings') return response([{ key: 'opds_enabled', value: 'true' }])
      if (url === '/api/v1/opds-users') return response([{ id: 1, userId: 5, username: 'reader', sortOrder: 'recent', pageSize: 50 }])
      if (url === '/api/v1/opds-users/1' && init?.method === 'PATCH') {
        return new Promise<Response>((resolve) => {
          resolvePatch = resolve
        })
      }
      return response({})
    })

    const wrapper = await mountSettings()
    const input = wrapper.get('#opds-page-size-1')
    const sortOrder = wrapper.get('select')

    await input.setValue(15)

    expect(input.attributes('disabled')).toBeDefined()
    expect(sortOrder.attributes('disabled')).toBeDefined()

    resolvePatch(response({ id: 1, userId: 5, username: 'reader', sortOrder: 'recent', pageSize: 15 }))
    await flushPromises()

    expect(input.attributes('disabled')).toBeUndefined()
    expect(sortOrder.attributes('disabled')).toBeUndefined()
  })

  it('saves a changed account page size through the OPDS user endpoint', async () => {
    const wrapper = await mountSettings()

    await wrapper.get('#opds-page-size-1').setValue(15)
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/opds-users/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageSize: 15 }),
    })
    expect(toastSuccessMock).toHaveBeenCalledWith('Page size updated for "reader"')
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it('restores the stored page size instead of sending a rejected value', async () => {
    const wrapper = await mountSettings()
    const input = wrapper.get('#opds-page-size-1')

    await input.setValue(0)
    await flushPromises()

    expect(apiMock).not.toHaveBeenCalledWith('/api/v1/opds-users/1', expect.anything())
    expect(input.element).toHaveProperty('value', '50')
  })
})
