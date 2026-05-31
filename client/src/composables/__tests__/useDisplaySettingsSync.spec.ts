import type { DisplayPreferences } from '@bookorbit/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

function validDisplayPreferences(overrides: Partial<DisplayPreferences> = {}): DisplayPreferences {
  return {
    portraitCoverSize: 180,
    squareCoverSize: 160,
    coverSizeScope: 'per-view',
    gridGap: 28,
    portraitGridGap: 24,
    squareGridGap: 20,
    viewMode: 'grid',
    cardOverlays: ['progress-bar', 'format', 'rating'],
    smartScopeFilterExpanded: true,
    authorCoverSize: 140,
    authorCoverShape: 'circle',
    tableZebraStriping: false,
    tableDensity: 'comfortable',
    bookSpineOverlay: 'subtle',
    bookShadowStrength: 'strong',
    bookCoverDisplayMode: 'blurred-fit',
    cardInfoMode: 'hover-overlay',
    seriesCardCoverMode: 'mosaic',
    gridCardPrimaryLabel: 'hidden',
    gridCardSecondaryLabel: 'hidden',
    ...overrides,
  }
}

async function loadModules(options: { syncEnabled?: boolean; token?: string | null } = {}) {
  vi.resetModules()
  localStorage.clear()

  const apiMock = vi.fn<(...args: unknown[]) => Promise<{ ok: boolean; json?: () => Promise<unknown> }>>()
  const toastErrorMock = vi.fn<() => void>()
  const authUser = ref({
    settings: { syncThemePreferences: options.syncEnabled ?? true },
  })

  vi.doMock('@/features/auth/composables/useAuth', () => ({
    useAuth: () => ({ user: authUser }),
  }))
  vi.doMock('@/lib/api', () => ({
    api: (...args: unknown[]) => apiMock(...args),
    getAccessToken: () => ('token' in options ? options.token : 'access-token'),
  }))
  vi.doMock('vue-sonner', () => ({
    toast: { error: toastErrorMock },
  }))

  const displaySettings = await import('../useDisplaySettings')
  const sync = await import('../useDisplaySettingsSync')

  return { apiMock, authUser, displaySettings, sync, toastErrorMock }
}

afterEach(() => {
  vi.useRealTimers()
  vi.resetModules()
  vi.unstubAllGlobals()
})

describe('useDisplaySettingsSync', () => {
  it('loads display settings from the server and applies sanitized values', async () => {
    const { apiMock, displaySettings, sync } = await loadModules()
    apiMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ settings: validDisplayPreferences({ bookCoverDisplayMode: 'natural-bottom' }) }),
    })

    await sync.loadDisplaySettingsFromServer()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/user-preferences/display')
    expect(displaySettings.useDisplaySettings().bookCoverDisplayMode.value).toBe('natural-bottom')
  })

  it('ignores missing or non-ok server display settings responses', async () => {
    const { apiMock, displaySettings, sync } = await loadModules()
    apiMock.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, json: async () => ({ settings: null }) })

    await sync.loadDisplaySettingsFromServer()
    await sync.loadDisplaySettingsFromServer()

    expect(displaySettings.useDisplaySettings().bookCoverDisplayMode.value).toBe('blurred-fit')
  })

  it('seeds display settings to the server with the expected payload shape', async () => {
    const { apiMock, sync } = await loadModules()
    apiMock.mockResolvedValueOnce({ ok: true })
    const prefs = validDisplayPreferences({ bookCoverDisplayMode: 'fill-crop' })

    await sync.seedDisplaySettingsToServer(prefs)

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/user-preferences/display',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ settings: prefs }),
      }),
    )
  })

  it('does not save when account preference sync is disabled', async () => {
    const { apiMock, sync } = await loadModules({ syncEnabled: false })

    await sync.saveDisplaySettingsToServer(validDisplayPreferences())

    expect(apiMock).not.toHaveBeenCalled()
  })

  it('shows a toast when a display settings save receives a non-ok response', async () => {
    const { apiMock, sync, toastErrorMock } = await loadModules()
    apiMock.mockResolvedValueOnce({ ok: false })

    await sync.saveDisplaySettingsToServer(validDisplayPreferences())

    expect(toastErrorMock).toHaveBeenCalledWith('Failed to save display preferences')
  })

  it('shows a toast when a display settings save throws', async () => {
    const { apiMock, sync, toastErrorMock } = await loadModules()
    apiMock.mockRejectedValueOnce(new Error('network down'))

    await sync.saveDisplaySettingsToServer(validDisplayPreferences())

    expect(toastErrorMock).toHaveBeenCalledWith('Failed to save display preferences')
  })

  it('debounces display setting changes before saving to the server', async () => {
    vi.useFakeTimers()
    const { apiMock, displaySettings, sync } = await loadModules()
    apiMock.mockResolvedValue({ ok: true })

    sync.initDisplaySettingsSync()
    displaySettings.useDisplaySettings().bookCoverDisplayMode.value = 'fill-crop'

    await vi.advanceTimersByTimeAsync(1499)
    expect(apiMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/user-preferences/display',
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"bookCoverDisplayMode":"fill-crop"'),
      }),
    )
  })

  it('cancels a pending debounced save', async () => {
    vi.useFakeTimers()
    const { apiMock, displaySettings, sync } = await loadModules()

    sync.initDisplaySettingsSync()
    displaySettings.useDisplaySettings().bookCoverDisplayMode.value = 'natural-bottom'
    sync.cancelPendingDisplaySettingsSync()
    await vi.advanceTimersByTimeAsync(1500)

    expect(apiMock).not.toHaveBeenCalled()
  })

  it('does not queue watcher saves while sync is disabled', async () => {
    vi.useFakeTimers()
    const { apiMock, displaySettings, sync } = await loadModules({ syncEnabled: false })

    sync.initDisplaySettingsSync()
    displaySettings.useDisplaySettings().bookCoverDisplayMode.value = 'fill-crop'
    await vi.advanceTimersByTimeAsync(1500)

    expect(apiMock).not.toHaveBeenCalled()
  })

  it('coalesces multiple display setting changes into one pending save', async () => {
    vi.useFakeTimers()
    const { apiMock, displaySettings, sync } = await loadModules()
    apiMock.mockResolvedValue({ ok: true })

    sync.initDisplaySettingsSync()
    displaySettings.useDisplaySettings().bookCoverDisplayMode.value = 'fill-crop'
    displaySettings.useDisplaySettings().bookShadowStrength.value = 'strong'
    await vi.advanceTimersByTimeAsync(1500)

    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/user-preferences/display',
      expect.objectContaining({
        body: expect.stringContaining('"bookShadowStrength":"strong"'),
      }),
    )
  })

  it('flushes a pending save with keepalive on pagehide', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn<() => Promise<Response>>().mockResolvedValue({ ok: true } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const { apiMock, displaySettings, sync } = await loadModules({ token: 'pagehide-token' })

    sync.initDisplaySettingsSync()
    displaySettings.useDisplaySettings().bookCoverDisplayMode.value = 'natural-bottom'
    window.dispatchEvent(new Event('pagehide'))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/user-preferences/display',
      expect.objectContaining({
        method: 'PUT',
        keepalive: true,
        headers: expect.objectContaining({ Authorization: 'Bearer pagehide-token' }),
        body: expect.stringContaining('"bookCoverDisplayMode":"natural-bottom"'),
      }),
    )
    await vi.advanceTimersByTimeAsync(1500)
    expect(apiMock).not.toHaveBeenCalled()
  })

  it('does not flush pagehide saves when no access token is available', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn<() => Promise<Response>>().mockResolvedValue({ ok: true } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const { displaySettings, sync } = await loadModules({ token: null })
    sync.initDisplaySettingsSync()
    displaySettings.useDisplaySettings().bookCoverDisplayMode.value = 'natural-bottom'
    window.dispatchEvent(new Event('pagehide'))

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('syncs seriesCardCoverMode changes to the server', async () => {
    vi.useFakeTimers()
    const { apiMock, displaySettings, sync } = await loadModules()
    apiMock.mockResolvedValue({ ok: true })

    sync.initDisplaySettingsSync()
    displaySettings.useDisplaySettings().seriesCardCoverMode.value = 'first-volume'
    await vi.advanceTimersByTimeAsync(1500)

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/user-preferences/display',
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"seriesCardCoverMode":"first-volume"'),
      }),
    )
  })

  it('loads seriesCardCoverMode from the server', async () => {
    const { apiMock, displaySettings, sync } = await loadModules()
    apiMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ settings: validDisplayPreferences({ seriesCardCoverMode: 'latest-volume' }) }),
    })

    await sync.loadDisplaySettingsFromServer()

    expect(displaySettings.useDisplaySettings().seriesCardCoverMode.value).toBe('latest-volume')
  })

  it('syncs gridCardPrimaryLabel changes to the server', async () => {
    vi.useFakeTimers()
    const { apiMock, displaySettings, sync } = await loadModules()
    apiMock.mockResolvedValue({ ok: true })

    sync.initDisplaySettingsSync()
    displaySettings.useDisplaySettings().gridCardPrimaryLabel.value = 'book-title'
    await vi.advanceTimersByTimeAsync(1500)

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/user-preferences/display',
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"gridCardPrimaryLabel":"book-title"'),
      }),
    )
  })

  it('syncs gridCardSecondaryLabel changes to the server', async () => {
    vi.useFakeTimers()
    const { apiMock, displaySettings, sync } = await loadModules()
    apiMock.mockResolvedValue({ ok: true })

    sync.initDisplaySettingsSync()
    displaySettings.useDisplaySettings().gridCardSecondaryLabel.value = 'author'
    await vi.advanceTimersByTimeAsync(1500)

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/user-preferences/display',
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"gridCardSecondaryLabel":"author"'),
      }),
    )
  })

  it('loads gridCardPrimaryLabel and gridCardSecondaryLabel from the server', async () => {
    const { apiMock, displaySettings, sync } = await loadModules()
    apiMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        settings: validDisplayPreferences({ gridCardPrimaryLabel: 'series-title', gridCardSecondaryLabel: 'author' }),
      }),
    })

    await sync.loadDisplaySettingsFromServer()

    const s = displaySettings.useDisplaySettings()
    expect(s.gridCardPrimaryLabel.value).toBe('series-title')
    expect(s.gridCardSecondaryLabel.value).toBe('author')
  })
})
