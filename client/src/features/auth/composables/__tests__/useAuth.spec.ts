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

vi.mock('@/router', () => ({
  default: {
    push: routerPushMock,
    currentRoute: { value: { query: {} } },
  },
}))

vi.mock('@/lib/api', () => ({
  api: apiMock,
  refreshAccessToken: refreshAccessTokenMock,
  setAccessToken: setAccessTokenMock,
  setOnAuthFailure: setOnAuthFailureMock,
}))

vi.mock('@/composables/useThemeSync', () => ({
  cancelPendingThemeSync: cancelPendingThemeSyncMock,
  initThemeSync: vi.fn<VoidFn>(),
  loadFromServer: vi.fn<() => Promise<void>>(),
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
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response),
    )
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
})
