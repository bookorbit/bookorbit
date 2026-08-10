import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RegisterError, useAuth } from '../composables/useAuth'

const { routerPushMock } = vi.hoisted(() => ({
  routerPushMock: vi.fn<(location: unknown) => void>(),
}))

vi.mock('@/router', () => ({
  default: { push: routerPushMock, currentRoute: { value: { query: {} } } },
}))

vi.mock('@/lib/api', () => ({
  api: vi.fn<() => void>(),
  refreshAccessToken: vi.fn<() => void>(),
  setAccessToken: vi.fn<() => void>(),
  setOnAuthFailure: vi.fn<() => void>(),
}))

vi.mock('@/composables/useDisplaySettingsSync', () => ({
  cancelPendingDisplaySettingsSync: vi.fn<() => void>(),
  initDisplaySettingsSync: vi.fn<() => void>(),
  loadDisplaySettingsFromServer: vi.fn<() => void>(),
}))
vi.mock('@/composables/useThemeSync', () => ({
  cancelPendingThemeSync: vi.fn<() => void>(),
  initThemeSync: vi.fn<() => void>(),
  loadFromServer: vi.fn<() => void>(),
}))
vi.mock('@/composables/useLocaleSync', () => ({
  cancelPendingLocaleSync: vi.fn<() => void>(),
  hydrateLocalePreference: vi.fn<() => void>(),
  initLocaleSync: vi.fn<() => void>(),
}))
vi.mock('@/features/settings/composables/useAuthorEnrichmentStatus', () => ({ disconnectAuthorEnrichmentSocket: vi.fn<() => void>() }))
vi.mock('@/features/book-metadata-fetch/composables/useBookMetadataFetchStatus', () => ({ disconnectBookMetadataFetchSocket: vi.fn<() => void>() }))
vi.mock('@/features/whats-new/composables/useWhatsNew', () => ({ resetWhatsNew: vi.fn<() => void>() }))
vi.mock('@/features/library/composables/useLibraries', () => ({ resetLibraries: vi.fn<() => void>() }))
vi.mock('@/features/smart-scope/composables/useSmartScopes', () => ({ resetSmartScopes: vi.fn<() => void>() }))
vi.mock('@/features/collection/composables/useCollections', () => ({ resetCollections: vi.fn<() => void>() }))
vi.mock('@/composables/useBrowseCounts', () => ({ resetBrowseCounts: vi.fn<() => void>() }))

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<unknown>>()

const PAYLOAD = { username: 'ada', name: 'Ada Lovelace', email: 'ada@example.com', password: 'Passw0rd' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
})

describe('useAuth.register', () => {
  it('posts the account details to the register endpoint', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 1, username: 'ada', name: 'Ada Lovelace' }) })

    await useAuth().register(PAYLOAD)

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(PAYLOAD),
    })
  })

  it('redirects to sign-in flagged as freshly registered', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 1 }) })

    await useAuth().register(PAYLOAD)

    expect(routerPushMock).toHaveBeenCalledWith({ path: '/login', query: { registered: '1' } })
  })

  it('does not sign the new account in', async () => {
    const { setAccessToken } = await import('@/lib/api')
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 1 }) })

    await useAuth().register(PAYLOAD)

    expect(setAccessToken).not.toHaveBeenCalled()
    expect(useAuth().user.value).toBeNull()
  })

  it('raises a RegisterError carrying the response status', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ message: 'Registration failed' }) })

    await expect(useAuth().register(PAYLOAD)).rejects.toMatchObject({ status: 409, message: 'Registration failed' })
    expect(routerPushMock).not.toHaveBeenCalled()
  })

  it('raises a RegisterError when registration is closed', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ message: 'Registration is not open' }) })

    await expect(useAuth().register(PAYLOAD)).rejects.toBeInstanceOf(RegisterError)
  })

  it('falls back to a default message when the error body is unreadable', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not json')
      },
    })

    await expect(useAuth().register(PAYLOAD)).rejects.toMatchObject({ status: 500, message: 'Failed to create account' })
  })
})
