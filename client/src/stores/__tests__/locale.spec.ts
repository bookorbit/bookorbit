import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const storedValues = new Map<string, unknown>()
const loadLocaleMessages = vi.fn<(locale: string) => Promise<void>>()
const activateI18nLocale = vi.fn<(locale: string) => void>()

vi.mock('@/services/storage', () => ({
  storage: {
    get: <T>(key: string, fallback: T): T => (storedValues.has(key) ? (storedValues.get(key) as T) : fallback),
    set: (key: string, value: unknown) => storedValues.set(key, value),
    remove: (key: string) => storedValues.delete(key),
  },
}))

vi.mock('@/i18n', () => ({
  loadLocaleMessages: (locale: string) => loadLocaleMessages(locale),
  activateI18nLocale: (locale: string) => activateI18nLocale(locale),
}))

describe('locale store', () => {
  beforeEach(() => {
    storedValues.clear()
    loadLocaleMessages.mockReset().mockResolvedValue(undefined)
    activateI18nLocale.mockReset()
    setActivePinia(createPinia())
  })

  it('matches exact locales before falling back to a supported base language', async () => {
    const { matchSupportedLocale } = await import('../locale')

    expect(matchSupportedLocale(['nl-NL', 'en-US'])).toBe('nl')
    expect(matchSupportedLocale(['de-DE', 'en-GB'])).toBe('de')
    expect(matchSupportedLocale(['nl-BE', 'en'])).toBe('nl')
    expect(matchSupportedLocale(['pt-BR'])).toBeNull()
  })

  it('prefers the stored locale over browser detection', async () => {
    storedValues.set('locale', 'nl')
    const { detectInitialLocale } = await import('../locale')

    expect(detectInitialLocale()).toBe('nl')
  })

  it('persists only after locale activation succeeds', async () => {
    loadLocaleMessages.mockRejectedValueOnce(new Error('chunk failed'))
    const { useLocaleStore } = await import('../locale')
    const store = useLocaleStore()

    await expect(store.setLocale('nl')).rejects.toThrow('chunk failed')
    expect(store.locale).toBe('en')
    expect(storedValues.has('locale')).toBe(false)

    await store.setLocale('nl')
    expect(store.locale).toBe('nl')
    expect(storedValues.get('locale')).toBe('nl')
  })

  it('ignores a stale lazy-load completion after a newer locale wins', async () => {
    let finishDutchLoad: (() => void) | undefined
    loadLocaleMessages.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishDutchLoad = resolve
        }),
    )
    const { useLocaleStore } = await import('../locale')
    const store = useLocaleStore()

    const dutchChange = store.setLocale('nl')
    await store.setLocale('en')
    finishDutchLoad?.()
    await dutchChange

    expect(store.locale).toBe('en')
    expect(activateI18nLocale).toHaveBeenCalledTimes(1)
    expect(activateI18nLocale).toHaveBeenCalledWith('en')
  })
})
