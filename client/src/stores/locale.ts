import { defineStore } from 'pinia'
import { ref } from 'vue'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, isSupportedLocale, type Locale } from '@bookorbit/types'
import { storage } from '@/services/storage'
import { activateI18nLocale, loadLocaleMessages } from '@/i18n'

const STORAGE_KEY = 'locale'

function canonicalizeLocale(value: string): string | null {
  try {
    return Intl.getCanonicalLocales(value)[0] ?? null
  } catch {
    return null
  }
}

export function matchSupportedLocale(candidates: readonly string[]): Locale | null {
  const supportedByCanonical = new Map<string, Locale>()
  for (const locale of SUPPORTED_LOCALES) {
    const canonical = canonicalizeLocale(locale)
    if (canonical) supportedByCanonical.set(canonical.toLowerCase(), locale)
  }

  for (const candidate of candidates) {
    const canonical = canonicalizeLocale(candidate)
    if (!canonical) continue
    const exact = supportedByCanonical.get(canonical.toLowerCase())
    if (exact) return exact
    const language = new Intl.Locale(canonical).language.toLowerCase()
    const baseLocale = supportedByCanonical.get(language)
    if (baseLocale) return baseLocale
  }

  return null
}

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
