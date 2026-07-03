import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const { apiMock, copyToClipboardMock, loadTokensMock, createTokenMock, revokeTokenMock, setActiveMock, tokens, loading, error } = vi.hoisted(() => {
  function makeRef<T>(value: T) {
    return { value, __v_isRef: true }
  }

  return {
    apiMock: vi.fn<(input: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>(),
    copyToClipboardMock: vi.fn<(text: string) => Promise<boolean>>(),
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

vi.mock('@/lib/clipboard', () => ({
  copyToClipboard: copyToClipboardMock,
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
    global: {
      stubs: {
        Tooltip: { template: '<div><slot /></div>' },
        TooltipTrigger: { template: '<div><slot /></div>' },
        TooltipContent: { template: '<div><slot /></div>' },
        RouterLink: { template: '<a><slot /></a>' },
      },
    },
  })
}

describe('MagicLinksSettings', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    tokens.value = []
    loading.value = false
    error.value = null
    loadTokensMock.mockResolvedValue(undefined)
    createTokenMock.mockResolvedValue({ id: 1, token: 'raw-token', label: 'Demo', expiresAt: null })
    revokeTokenMock.mockResolvedValue(undefined)
    setActiveMock.mockResolvedValue(undefined)
    copyToClipboardMock.mockResolvedValue(true)
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

  it('keeps copied feedback for the latest copied magic link', async () => {
    vi.useFakeTimers()
    tokens.value = [
      {
        id: 1,
        rawToken: 'first-token',
        label: 'First',
        username: 'first',
        createdByUsername: 'admin',
        expiresAt: null,
        revokedAt: null,
        isActive: true,
        useCount: 0,
        lastUsedAt: null,
      },
      {
        id: 2,
        rawToken: 'second-token',
        label: 'Second',
        username: 'second',
        createdByUsername: 'admin',
        expiresAt: null,
        revokedAt: null,
        isActive: true,
        useCount: 0,
        lastUsedAt: null,
      },
    ]
    const wrapper = mountComponent({ withHeader: false })
    await flushPromises()

    const actionButtons = wrapper.findAll('button').filter((button) => button.classes().includes('p-1.5'))
    await actionButtons[0]?.trigger('click')
    await vi.advanceTimersByTimeAsync(1000)
    await actionButtons[3]?.trigger('click')
    await vi.advanceTimersByTimeAsync(1500)

    expect(copyToClipboardMock).toHaveBeenLastCalledWith(expect.stringContaining('second-token'))
    expect(wrapper.text()).toContain('Copied!')

    await vi.advanceTimersByTimeAsync(500)
    expect(wrapper.text()).not.toContain('Copied!')
    vi.useRealTimers()
  })
})
