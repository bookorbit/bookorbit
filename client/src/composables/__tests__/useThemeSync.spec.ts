import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive, ref } from 'vue'
import type { ThemePreferences } from '@bookorbit/types'

const user = ref<{ settings?: { syncThemePreferences?: boolean } } | null>(null)
const toastError = vi.fn<(message: string) => void>()
const apiMock = vi.fn<(...args: unknown[]) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>()

function createThemeStore() {
  return reactive({
    theme: 'dark' as ThemePreferences['theme'],
    accent: 'blue' as ThemePreferences['accent'],
    radius: 'rounded' as ThemePreferences['radius'],
    background: 'vinyl' as ThemePreferences['background'],
    brightness: 35,
    setTheme(nextTheme: ThemePreferences['theme']) {
      this.theme = nextTheme
    },
    setAccent(nextAccent: ThemePreferences['accent']) {
      this.accent = nextAccent
    },
    setRadius(nextRadius: ThemePreferences['radius']) {
      this.radius = nextRadius
    },
    setBackground(nextBackground: ThemePreferences['background']) {
      this.background = nextBackground
    },
    setBrightness(nextBrightness: number) {
      this.brightness = nextBrightness
    },
  })
}

let themeStore = createThemeStore()

function mockJsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: vi.fn<() => Promise<unknown>>().mockResolvedValue(body),
  }
}

vi.mock('@/stores/theme', () => ({
  useThemeStore: () => themeStore,
}))

vi.mock('@/features/auth/composables/useAuth', () => ({
  useAuth: () => ({ user }),
}))

vi.mock('@/lib/api', () => ({
  api: (...args: unknown[]) => apiMock(...args),
  getAccessToken: () => 'test-access-token',
}))

vi.mock('vue-sonner', () => ({
  toast: { error: toastError },
}))

describe('useThemeSync', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
    user.value = { settings: { syncThemePreferences: false } }
    themeStore = createThemeStore()
    apiMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loadFromServer applies valid fields from the server payload', async () => {
    apiMock.mockResolvedValueOnce(
      mockJsonResponse({
        settings: {
          theme: 'light',
          accent: 'rose',
          radius: 'pill',
          background: 'mesh',
          brightness: 72,
        },
      }),
    )

    const { loadFromServer } = await import('../useThemeSync')
    await loadFromServer()

    expect(themeStore.theme).toBe('light')
    expect(themeStore.accent).toBe('rose')
    expect(themeStore.radius).toBe('pill')
    expect(themeStore.background).toBe('mesh')
    expect(themeStore.brightness).toBe(72)
  })

  it('loadFromServer applies a synchronized system theme selection', async () => {
    apiMock.mockResolvedValueOnce(
      mockJsonResponse({ settings: { theme: 'system', accent: 'blue', radius: 'rounded', background: 'vinyl', brightness: 35 } }),
    )

    const { loadFromServer } = await import('../useThemeSync')
    await loadFromServer()

    expect(themeStore.theme).toBe('system')
  })

  it('loadFromServer no-ops when server settings are null', async () => {
    apiMock.mockResolvedValueOnce(mockJsonResponse({ settings: null }))

    const { loadFromServer } = await import('../useThemeSync')
    await loadFromServer()

    expect(themeStore.theme).toBe('dark')
    expect(themeStore.accent).toBe('blue')
    expect(themeStore.radius).toBe('rounded')
    expect(themeStore.background).toBe('vinyl')
    expect(themeStore.brightness).toBe(35)
  })

  it('loadFromServer swallows api errors', async () => {
    apiMock.mockRejectedValueOnce(new Error('boom'))

    const { loadFromServer } = await import('../useThemeSync')

    await expect(loadFromServer()).resolves.toBeUndefined()
  })

  it('loadFromServer sanitizes invalid values and keeps existing local ones', async () => {
    apiMock.mockResolvedValueOnce(
      mockJsonResponse({
        settings: {
          theme: 'light',
          accent: 'invalid',
          radius: 'pill',
          background: 'not-real',
          brightness: 101,
        },
      }),
    )

    const { loadFromServer } = await import('../useThemeSync')
    await loadFromServer()

    expect(themeStore.theme).toBe('light')
    expect(themeStore.accent).toBe('blue')
    expect(themeStore.radius).toBe('pill')
    expect(themeStore.background).toBe('vinyl')
    expect(themeStore.brightness).toBe(35)
  })

  it('loadFromServer does not trigger a save request while applying server data', async () => {
    user.value = { settings: { syncThemePreferences: true } }
    apiMock.mockResolvedValueOnce(
      mockJsonResponse({ settings: { theme: 'light', accent: 'rose', radius: 'pill', background: 'mesh', brightness: 70 } }),
    )

    const { initThemeSync, loadFromServer } = await import('../useThemeSync')
    initThemeSync()
    await loadFromServer()
    await vi.advanceTimersByTimeAsync(1600)

    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(apiMock).toHaveBeenCalledWith('/api/v1/user-preferences/theme')
  })

  it('saveToServer calls PUT with the expected payload', async () => {
    user.value = { settings: { syncThemePreferences: true } }
    apiMock.mockResolvedValueOnce(mockJsonResponse({}, true))
    const prefs: ThemePreferences = {
      theme: 'dark',
      accent: 'blue',
      radius: 'rounded',
      background: 'vinyl',
      brightness: 35,
    }

    const { saveToServer } = await import('../useThemeSync')
    await saveToServer(prefs)

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/user-preferences/theme',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ settings: prefs }),
      }),
    )
  })

  it('saveToServer shows a toast when the server rejects the request', async () => {
    user.value = { settings: { syncThemePreferences: true } }
    apiMock.mockResolvedValueOnce(mockJsonResponse({}, false))

    const { saveToServer } = await import('../useThemeSync')
    await saveToServer({
      theme: 'dark',
      accent: 'blue',
      radius: 'rounded',
      background: 'vinyl',
      brightness: 35,
    })

    expect(toastError).toHaveBeenCalledWith('Failed to save theme preferences')
  })

  it('initThemeSync is idempotent', async () => {
    user.value = { settings: { syncThemePreferences: true } }
    apiMock.mockResolvedValue(mockJsonResponse({}, true))

    const { initThemeSync } = await import('../useThemeSync')
    initThemeSync()
    initThemeSync()

    themeStore.setAccent('rose')
    await vi.advanceTimersByTimeAsync(1600)

    expect(apiMock).toHaveBeenCalledTimes(1)
  })

  it('watcher only saves when sync is enabled', async () => {
    apiMock.mockResolvedValue(mockJsonResponse({}, true))

    const { initThemeSync } = await import('../useThemeSync')
    initThemeSync()

    themeStore.setAccent('rose')
    await vi.advanceTimersByTimeAsync(1600)
    expect(apiMock).not.toHaveBeenCalled()

    user.value = { settings: { syncThemePreferences: true } }
    themeStore.setAccent('green')
    await vi.advanceTimersByTimeAsync(1600)

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/user-preferences/theme',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          settings: {
            theme: 'dark',
            accent: 'green',
            radius: 'rounded',
            background: 'vinyl',
            brightness: 35,
          },
        }),
      }),
    )
  })

  it('cancelPendingThemeSync prevents a scheduled save from firing', async () => {
    user.value = { settings: { syncThemePreferences: true } }
    apiMock.mockResolvedValue(mockJsonResponse({}, true))

    const { initThemeSync, cancelPendingThemeSync } = await import('../useThemeSync')
    initThemeSync()

    themeStore.setAccent('rose')
    cancelPendingThemeSync()
    await vi.advanceTimersByTimeAsync(1600)

    expect(apiMock).not.toHaveBeenCalled()
  })
})
