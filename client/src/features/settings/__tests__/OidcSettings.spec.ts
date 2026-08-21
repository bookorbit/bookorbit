import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { OidcErrorCode } from '@bookorbit/types'

const { apiMock } = vi.hoisted(() => ({
  apiMock: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
}))

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn<() => void>(), error: vi.fn<() => void>() },
}))

import OidcSettings from '../OidcSettings.vue'

function response(ok: boolean, body: unknown) {
  return { ok, json: async () => body } as Response
}

async function mountCreateForm() {
  const wrapper = mount(OidcSettings, { props: { embedded: true } })
  await flushPromises()

  const addProvider = wrapper.findAll('button').find((button) => button.text().includes('Add Provider'))
  expect(addProvider).toBeDefined()
  await addProvider?.trigger('click')

  await wrapper.get('input[placeholder="https://accounts.example.com"]').setValue('https://pocket-id.example.com')
  return wrapper
}

async function testConnection(wrapper: VueWrapper) {
  const testButton = wrapper.findAll('button').find((button) => button.text() === 'Test')
  expect(testButton).toBeDefined()
  await testButton?.trigger('click')
  await flushPromises()
}

describe('OidcSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    apiMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/v1/app-settings/oidc/providers') return response(true, [])
      return response(false, {})
    })
  })

  it('localizes the private issuer error code returned by the server', async () => {
    apiMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/v1/app-settings/oidc/providers') return response(true, [])
      return response(false, {
        errorCode: OidcErrorCode.PRIVATE_ISSUER_ADDRESS,
        message: 'Server copy must not be rendered',
      })
    })
    const wrapper = await mountCreateForm()

    await testConnection(wrapper)

    expect(wrapper.text()).toContain('The issuer URL resolves to a private or local network address')
    expect(wrapper.text()).not.toContain('Server copy must not be rendered')
  })

  it('uses localized generic copy for an unknown server error code', async () => {
    apiMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/v1/app-settings/oidc/providers') return response(true, [])
      return response(false, {
        errorCode: 'oidc_unknown_error',
        message: 'Untranslated server copy',
      })
    })
    const wrapper = await mountCreateForm()

    await testConnection(wrapper)

    expect(wrapper.text()).toContain('Connection failed')
    expect(wrapper.text()).not.toContain('Untranslated server copy')
  })
})
