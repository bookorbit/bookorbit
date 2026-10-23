import { beforeEach, describe, expect, it, vi } from 'vitest'

type VoidFn = () => void

const routerPushMock = vi.hoisted(() => vi.fn<(to: string) => void>())
const setAccessTokenMock = vi.hoisted(() => vi.fn<(token: string | null) => void>())
const setOnAuthFailureMock = vi.hoisted(() => vi.fn<(fn: VoidFn) => void>())
const refreshAccessTokenMock = vi.hoisted(() => vi.fn<() => Promise<string>>())
const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>())
const resetLibrariesMock = vi.hoisted(() => vi.fn<VoidFn>())
const resetSmartScopesMock = vi.hoisted(() => vi.fn<VoidFn>())
const resetCollectionsMock = vi.hoisted(() => vi.fn<VoidFn>())
const resetWhatsNewMock = vi.hoisted(() => vi.fn<VoidFn>())
const cancelPendingThemeSyncMock = vi.hoisted(() => vi.fn<VoidFn>())
const cancelPendingDisplaySettingsSyncMock = vi.hoisted(() => vi.fn<VoidFn>())
const disconnectAuthorEnrichmentSocketMock = vi.hoisted(() => vi.fn<VoidFn>())
const disconnectBookMetadataFetchSocketMock = vi.hoisted(() => vi.fn<VoidFn>())
const currentRouteMock = vi.hoisted(() => ({ value: { query: {}, meta: {} as { public?: boolean } } }))
const initThemeSyncMock = vi.hoisted(() => vi.fn<VoidFn>())
// Stands in for the real class, which pulls in i18n; identity survives vi.resetModules().
const NetworkErrorMock = vi.hoisted(() => class NetworkError extends Error {})

vi.mock('@/router', () => ({
  default: {
    push: routerPushMock,
    currentRoute: currentRouteMock,
  },
}))

vi.mock('@/lib/api', () => ({
  api: apiMock,
  fetchWithAuthProxyRecovery: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, redirect: 'manual' }),
  isServerUnavailableStatus: (status: number) => status >= 500 || status === 408 || status === 429,
  NetworkError: NetworkErrorMock,
  refreshAccessToken: refreshAccessTokenMock,
  setAccessToken: setAccessTokenMock,
  setOnAuthFailure: setOnAuthFailureMock,
}))

vi.mock('@/composables/useThemeSync', () => ({
  cancelPendingThemeSync: cancelPendingThemeSyncMock,
  initThemeSync: initThemeSyncMock,
  loadFromServer: vi.fn<() => Promise<void>>(),
}))

vi.mock('@/composables/useLocaleSync', () => ({
  cancelPendingLocaleSync: vi.fn<VoidFn>(),
  hydrateLocalePreference: vi.fn<() => Promise<void>>(async () => {}),
  initLocaleSync: vi.fn<VoidFn>(),
}))

vi.mock('@/composables/useDisplaySettingsSync', () => ({
  cancelPendingDisplaySettingsSync: cancelPendingDisplaySettingsSyncMock,
  initDisplaySettingsSync: vi.fn<VoidFn>(),
  loadDisplaySettingsFromServer: vi.fn<() => Promise<void>>(),
}))

vi.mock('../useSetupStatus', () => ({
  useSetupStatus: () => ({
    needsSetup: { value: false },
  }),
}))

vi.mock('@/features/settings/composables/useAuthorEnrichmentStatus', () => ({
  disconnectAuthorEnrichmentSocket: disconnectAuthorEnrichmentSocketMock,
}))

vi.mock('@/features/book-metadata-fetch/composables/useBookMetadataFetchStatus', () => ({
  disconnectBookMetadataFetchSocket: disconnectBookMetadataFetchSocketMock,
}))

vi.mock('@/features/whats-new/composables/useWhatsNew', () => ({
  resetWhatsNew: resetWhatsNewMock,
}))

vi.mock('@/features/library/composables/useLibraries', () => ({
  resetLibraries: resetLibrariesMock,
}))

vi.mock('@/features/smart-scope/composables/useSmartScopes', () => ({
  resetSmartScopes: resetSmartScopesMock,
}))

vi.mock('@/features/collection/composables/useCollections', () => ({
  resetCollections: resetCollectionsMock,
}))

describe('useAuth', () => {
  beforeEach(() => {
    vi.resetModules()
    routerPushMock.mockReset()
    setAccessTokenMock.mockReset()
    setOnAuthFailureMock.mockReset()
    refreshAccessTokenMock.mockReset()
    apiMock.mockReset()
    resetLibrariesMock.mockReset()
    resetSmartScopesMock.mockReset()
    resetCollectionsMock.mockReset()
    resetWhatsNewMock.mockReset()
    cancelPendingThemeSyncMock.mockReset()
    cancelPendingDisplaySettingsSyncMock.mockReset()
    disconnectAuthorEnrichmentSocketMock.mockReset()
    disconnectBookMetadataFetchSocketMock.mockReset()
    initThemeSyncMock.mockReset()
    currentRouteMock.value = { query: {}, meta: {} }
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response),
    )
  })

  it('carries the lockout code and retry window off a rejected login', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue({
        ok: false,
        json: async () => ({ message: 'Account temporarily locked', errorCode: 'account_locked', retryAfterSeconds: 540 }),
      } as Response),
    )
    const { useAuth, LoginError } = await import('../useAuth')

    const error = await useAuth()
      .login('ada', 'correct-horse')
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(LoginError)
    expect((error as InstanceType<typeof LoginError>).errorCode).toBe('account_locked')
    expect((error as InstanceType<typeof LoginError>).retryAfterSeconds).toBe(540)
  })

  it('clears user-scoped sidebar caches on logout', async () => {
    const { useAuth } = await import('../useAuth')

    await useAuth().logout()

    expect(resetLibrariesMock).toHaveBeenCalledTimes(1)
    expect(resetSmartScopesMock).toHaveBeenCalledTimes(1)
    expect(resetCollectionsMock).toHaveBeenCalledTimes(1)
    expect(setAccessTokenMock).toHaveBeenCalledWith(null)
    expect(routerPushMock).toHaveBeenCalledWith('/login')
  })
  it('finishes local sign-out when the server is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network unavailable')))
    const { useAuth } = await import('../useAuth')
    await expect(useAuth().logout()).resolves.toBeUndefined()
    expect(setAccessTokenMock).toHaveBeenCalledWith(null)
    expect(routerPushMock).toHaveBeenCalledWith('/login')
  })

  it('uses the local login route after successful logout', async () => {
    const readBody = vi.fn<() => unknown>()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue({ ok: true, json: readBody } as unknown as Response))
    const { useAuth } = await import('../useAuth')
    await useAuth().logout()
    expect(readBody).not.toHaveBeenCalled()
    expect(routerPushMock).toHaveBeenCalledWith('/login')
  })

  it('sends a protected page to sign-in when the session is rejected', async () => {
    await import('../useAuth')
    const onAuthFailure = setOnAuthFailureMock.mock.calls[0]![0]

    onAuthFailure()

    expect(setAccessTokenMock).toHaveBeenCalledWith(null)
    expect(routerPushMock).toHaveBeenCalledWith('/login')
  })

  describe('init', () => {
    it('reports an unreachable server instead of an anonymous visitor', async () => {
      refreshAccessTokenMock.mockRejectedValue(new NetworkErrorMock('refresh answered 500'))
      const { useAuth } = await import('../useAuth')

      await expect(useAuth().init()).resolves.toBe('unreachable')
      expect(useAuth().user.value).toBeNull()
      // A later attempt starts the syncs, so they must not start twice.
      expect(initThemeSyncMock).not.toHaveBeenCalled()
    })

    it('reports an unreachable server when the profile request is answered by a proxy', async () => {
      refreshAccessTokenMock.mockResolvedValue('token')
      apiMock.mockResolvedValue(new Response('', { status: 502 }))
      const { useAuth } = await import('../useAuth')

      await expect(useAuth().init()).resolves.toBe('unreachable')
    })

    it('reports an anonymous visitor when the refresh is refused', async () => {
      refreshAccessTokenMock.mockRejectedValue(new Error('refresh failed'))
      const { useAuth } = await import('../useAuth')

      await expect(useAuth().init()).resolves.toBe('anonymous')
      expect(initThemeSyncMock).toHaveBeenCalledTimes(1)
    })

    it('reports an authenticated reader once the profile loads', async () => {
      refreshAccessTokenMock.mockResolvedValue('token')
      apiMock.mockResolvedValue(new Response(JSON.stringify({ id: 7, settings: {} }), { status: 200 }))
      const { useAuth } = await import('../useAuth')

      await expect(useAuth().init()).resolves.toBe('authenticated')
      expect(useAuth().user.value).toMatchObject({ id: 7 })
    })
  })

  it('stays on a public page when the session is rejected', async () => {
    currentRouteMock.value = { query: {}, meta: { public: true } }
    await import('../useAuth')
    const onAuthFailure = setOnAuthFailureMock.mock.calls[0]![0]

    onAuthFailure()

    expect(setAccessTokenMock).toHaveBeenCalledWith(null)
    expect(routerPushMock).not.toHaveBeenCalled()
  })
})
