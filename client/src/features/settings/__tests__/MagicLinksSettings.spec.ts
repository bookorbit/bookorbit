import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const { apiMock, loadTokensMock, createTokenMock, revokeTokenMock, setActiveMock, tokens, loading, error } = vi.hoisted(() => {
  function makeRef<T>(value: T) {
    return { value, __v_isRef: true }
  }

  return {
    apiMock: vi.fn<(input: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>(),
    loadTokensMock: vi.fn<() => Promise<void>>(),
    createTokenMock: vi.fn<() => Promise<unknown>>(),
    revokeTokenMock: vi.fn<() => Promise<void>>(),
    setActiveMock: vi.fn<() => Promise<void>>(),
    tokens: makeRef<unknown[]>([]),
    loading: makeRef(false),
    error: makeRef<string | null>(null),
  }
})

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

vi.mock('@/features/settings/composables/useMagicLinks', () => ({
  useMagicLinks: () => ({
    tokens,
    loading,
    error,
    loadTokens: loadTokensMock,
    createToken: createTokenMock,
    revokeToken: revokeTokenMock,
    setActive: setActiveMock,
  }),
}))

vi.mock('../SettingsPageHeader.vue', () => ({
  default: { template: '<div><slot /></div>' },
}))

import MagicLinksSettings from '../MagicLinksSettings.vue'

function mockSharedUsers(users: Array<{ id: number; username: string; name: string }>) {
  apiMock.mockImplementation(async (input: string) => {
    if (input === '/api/v1/users?provisioningMethod=shared&pageSize=100') {
      return { ok: true, json: async () => ({ users }) }
    }
    return { ok: false, json: async () => ({}) }
  })
}

function mountComponent(props: { withHeader?: boolean; withEmbeddedCreateAction?: boolean } = {}) {
  return mount(MagicLinksSettings, {
    props,
  })
}

describe('MagicLinksSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tokens.value = []
    loading.value = false
    error.value = null
    loadTokensMock.mockResolvedValue(undefined)
    createTokenMock.mockResolvedValue({ id: 1, token: 'raw-token', label: 'Demo', expiresAt: null })
    revokeTokenMock.mockResolvedValue(undefined)
    setActiveMock.mockResolvedValue(undefined)
    mockSharedUsers([])
  })

  it('shows a working Create link action when embedded and shared users exist', async () => {
    mockSharedUsers([{ id: 42, username: 'demo', name: 'Demo User' }])
    const wrapper = mountComponent({ withHeader: false, withEmbeddedCreateAction: true })
    await flushPromises()

    const createButton = wrapper.findAll('button').find((button) => button.text().includes('Create link'))

    expect(createButton).toBeDefined()
    expect(createButton?.attributes('disabled')).toBeUndefined()

    await createButton?.trigger('click')

    expect(wrapper.text()).toContain('Create magic link')
    expect(wrapper.text()).toContain('Demo User (@demo)')
  })

  it('keeps the embedded Create link action disabled until a shared user exists', async () => {
    const wrapper = mountComponent({ withHeader: false, withEmbeddedCreateAction: true })
    await flushPromises()

    const createButton = wrapper.findAll('button').find((button) => button.text().includes('Create link'))

    expect(createButton).toBeDefined()
    expect(createButton?.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('No shared accounts found')
    expect(wrapper.text()).not.toContain('Create magic link')
  })

  it('does not render the embedded Create link action unless the parent opts in', async () => {
    mockSharedUsers([{ id: 42, username: 'demo', name: 'Demo User' }])
    const wrapper = mountComponent({ withHeader: false })
    await flushPromises()

    const createButton = wrapper.findAll('button').find((button) => button.text().includes('Create link'))

    expect(createButton).toBeUndefined()
  })
})
