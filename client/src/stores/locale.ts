import { defineStore } from 'pinia'
import { ref } from 'vue'
import { DEFAULT_LOCALE, isSupportedLocale, type Locale } from '@bookorbit/types'
import { storage } from '@/services/storage'
import { setI18nLocale } from '@/i18n'

const STORAGE_KEY = 'locale'

/** Resolve the initial locale: stored preference, then browser language, then default. */
export function detectInitialLocale(): Locale {
  const stored = storage.get<string>(STORAGE_KEY, '')
  if (isSupportedLocale(stored)) return stored

  if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
    const base = navigator.language.split('-')[0]
    if (isSupportedLocale(base)) return base
  }

  return DEFAULT_LOCALE
}

export const useLocaleStore = defineStore('locale', () => {
  const locale = ref<Locale>(detectInitialLocale())

  /** Apply a locale to vue-i18n and, unless applying server prefs, persist it locally. */
  async function setLocale(next: Locale, persist = true): Promise<void> {
    locale.value = next
    await setI18nLocale(next)
    if (persist) storage.set(STORAGE_KEY, next)
  }

  return { locale, setLocale }
})
