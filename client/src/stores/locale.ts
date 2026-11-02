import { defineStore } from 'pinia'
import { ref } from 'vue'
import { DEFAULT_LOCALE, isSupportedLocale, matchSupportedLocale, type Locale } from '@bookorbit/types'
import { storage } from '@/services/storage'
import { activateI18nLocale, loadLocaleMessages } from '@/i18n'

const STORAGE_KEY = 'locale'

// The server negotiates `Accept-Language` with the same matcher, so it lives with the locale list.
export { matchSupportedLocale }

export function detectInitialLocale(): Locale {
  const stored = storage.get<string>(STORAGE_KEY, '')
  if (isSupportedLocale(stored)) return stored

  if (typeof navigator !== 'undefined') {
    const candidates = Array.isArray(navigator.languages) && navigator.languages.length > 0 ? navigator.languages : [navigator.language]
    const detected = matchSupportedLocale(candidates.filter((candidate): candidate is string => typeof candidate === 'string'))
    if (detected) return detected
  }

  return DEFAULT_LOCALE
}

export const useLocaleStore = defineStore('locale', () => {
  const locale = ref<Locale>(detectInitialLocale())
  let activationId = 0

  async function setLocale(next: Locale): Promise<void> {
    const currentActivationId = ++activationId
    await loadLocaleMessages(next)
    if (currentActivationId !== activationId) return
    activateI18nLocale(next)
    locale.value = next
    storage.set(STORAGE_KEY, next)
  }

  return { locale, setLocale }
})
