import type { WritableComputedRef } from 'vue'
import { createI18n } from 'vue-i18n'
import { DEFAULT_LOCALE, type Locale } from '@bookorbit/types'
import en from '@/locales/en.json'

export type MessageSchema = typeof en

// `legacy: false` selects the Composition API overload, so `i18n.global` is a Composer
// and `i18n.global.locale` is a writable ref.
export const i18n = createI18n({
  legacy: false,
  locale: DEFAULT_LOCALE,
  fallbackLocale: DEFAULT_LOCALE,
  // Some messages intentionally contain inline HTML (e.g. <strong>/<code> in explanatory notes)
  // rendered via v-html or <i18n-t>. Disable the HTML-in-message warning/throw.
  warnHtmlMessage: false,
  // Non-default locales are loaded on demand via loadLocaleMessages().
  messages: { en },
})

const loaded = new Set<Locale>([DEFAULT_LOCALE])

/** Dynamically import and register the message catalog for a locale (no-op if already loaded). */
export async function loadLocaleMessages(locale: Locale): Promise<void> {
  if (loaded.has(locale)) return
  const messages = (await import(`../locales/${locale}.json`)) as { default: MessageSchema }
  i18n.global.setLocaleMessage(locale, messages.default)
  loaded.add(locale)
}

/** Load (if needed) and activate a locale, updating the document's lang attribute. */
export async function setI18nLocale(locale: Locale): Promise<void> {
  await loadLocaleMessages(locale)
  // The setter is narrowed to the eagerly-bundled locale keys; widen to any supported locale.
  ;(i18n.global.locale as WritableComputedRef<Locale>).value = locale
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('lang', locale)
  }
}
