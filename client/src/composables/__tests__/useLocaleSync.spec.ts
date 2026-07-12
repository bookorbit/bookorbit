import { nextTick, reactive, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthUser, Locale } from '@bookorbit/types'

const user = ref<AuthUser | null>(null)
const apiMock = vi.fn<(...args: unknown[]) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>()
const toastError = vi.fn<(message: string) => void>()

let localeStore = createLocaleStore()

function createLocaleStore() {
  const store = reactive({
    locale: 'en' as Locale,
    async setLocale(locale: Locale) {
      store.locale = locale
    },
  })
  return store
}

function mockJsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: vi.fn<() => Promise<unknown>>().mockResolvedValue(body),
  }
}

vi.mock('@/features/auth/composables/useAuth', () => ({
  useAuth: () => ({ user }),
}))

vi.mock('@/stores/locale', () => ({
  useLocaleStore: () => localeStore,
}))

vi.mock('@/lib/api', () => ({
  api: (...args: unknown[]) => apiMock(...args),
  getAccessToken: () => 'test-access-token',
}))

vi.mock('@/i18n', () => ({
  i18n: { global: { t: (key: string) => key } },
}))

vi.mock('vue-sonner', () => ({
  toast: { error: toastError },
}))

describe('useLocaleSync', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
    user.value = null
    localeStore = createLocaleStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('applies the authenticated user locale from the server', async () => {
    user.value = { id: 7 } as AuthUser
    apiMock.mockResolvedValueOnce(mockJsonResponse({ settings: { locale: 'nl' } }))

    const { hydrateLocalePreference } = await import('../useLocaleSync')
    await hydrateLocalePreference()

    expect(localeStore.locale).toBe('nl')
    expect(apiMock).toHaveBeenCalledWith('/api/v1/user-preferences/locale')
  })

  it('seeds the current locale when the account has no preference', async () => {
    user.value = { id: 7 } as AuthUser
    apiMock.mockResolvedValueOnce(mockJsonResponse({ settings: null })).mockResolvedValueOnce(mockJsonResponse({}, true))

    const { hydrateLocalePreference } = await import('../useLocaleSync')
    await hydrateLocalePreference()

    expect(apiMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/user-preferences/locale',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ settings: { locale: 'en' } }) }),
    )
  })

  it('persists locale changes for authenticated users', async () => {
    user.value = { id: 7 } as AuthUser
    apiMock.mockResolvedValue(mockJsonResponse({}, true))

    const { initLocaleSync } = await import('../useLocaleSync')
    initLocaleSync()
    localeStore.locale = 'nl'
    await nextTick()
    await vi.advanceTimersByTimeAsync(1600)

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/user-preferences/locale',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ settings: { locale: 'nl' } }) }),
    )
  })

  it('keeps anonymous locale changes browser-only', async () => {
    const { initLocaleSync } = await import('../useLocaleSync')
    initLocaleSync()
    localeStore.locale = 'nl'
    await nextTick()
    await vi.advanceTimersByTimeAsync(1600)

    expect(apiMock).not.toHaveBeenCalled()
  })

  it('does not echo a server locale back through the save watcher', async () => {
    user.value = { id: 7 } as AuthUser
    apiMock.mockResolvedValueOnce(mockJsonResponse({ settings: { locale: 'nl' } }))

    const { hydrateLocalePreference, initLocaleSync } = await import('../useLocaleSync')
    initLocaleSync()
    await hydrateLocalePreference()
    await vi.advanceTimersByTimeAsync(1600)

    expect(apiMock).toHaveBeenCalledTimes(1)
  })
})
