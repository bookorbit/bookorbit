import { isSupportedLocale, type Locale, type LocalePreferences } from '@bookorbit/types'
import { watch } from 'vue'
import { toast } from 'vue-sonner'
import { i18n } from '@/i18n'
import { useAuth } from '@/features/auth/composables/useAuth'
import { api, getAccessToken } from '@/lib/api'
import { useLocaleStore } from '@/stores/locale'

let initialized = false
let isApplyingServerPrefs = false
let pendingSave: ReturnType<typeof setTimeout> | null = null
let pagehideRegistered = false

function isAuthenticated(): boolean {
  const { user } = useAuth()
  return user.value !== null
}

function getCurrentPrefs(): LocalePreferences {
  const store = useLocaleStore()
  return { locale: store.locale }
}

function sanitizeServerPrefs(raw: unknown): Locale | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = (raw as Record<string, unknown>).locale
  return isSupportedLocale(value) ? value : null
}

function flushPendingSave(): void {
  if (pendingSave === null || !isAuthenticated()) return

  clearTimeout(pendingSave)
  pendingSave = null

  const accessToken = getAccessToken()
  if (!accessToken) return

  void fetch('/api/v1/user-preferences/locale', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    credentials: 'include',
    keepalive: true,
    body: JSON.stringify({ settings: getCurrentPrefs() }),
  })
}

export async function hydrateLocalePreference(): Promise<void> {
  try {
    const res = await api('/api/v1/user-preferences/locale')
    if (!res.ok) return

    const body = (await res.json()) as { settings: unknown }
    const locale = sanitizeServerPrefs(body.settings)
    if (locale === null) {
      await seedLocaleToServer(getCurrentPrefs())
      return
    }

    const store = useLocaleStore()
    isApplyingServerPrefs = true
    try {
      await store.setLocale(locale)
    } finally {
      isApplyingServerPrefs = false
    }
  } catch {
    // Silent on startup.
  }
}

export async function seedLocaleToServer(prefs: LocalePreferences): Promise<void> {
  try {
    await api('/api/v1/user-preferences/locale', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: prefs }),
    })
  } catch {
    // Silent seed failure.
  }
}

export async function saveLocaleToServer(prefs: LocalePreferences): Promise<void> {
  if (!isAuthenticated()) return

  try {
    const res = await api('/api/v1/user-preferences/locale', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: prefs }),
    })

    if (!res.ok) {
      toast.error(i18n.global.t('settings.appearance.language.saveError'))
    }
  } catch {
    toast.error(i18n.global.t('settings.appearance.language.saveError'))
  }
}

export function cancelPendingLocaleSync(): void {
  if (pendingSave !== null) {
    clearTimeout(pendingSave)
    pendingSave = null
  }
}

export function initLocaleSync(): void {
  if (initialized) return
  initialized = true

  const store = useLocaleStore()

  watch(
    () => store.locale,
    () => {
      if (isApplyingServerPrefs || !isAuthenticated()) return

      if (pendingSave !== null) clearTimeout(pendingSave)
      pendingSave = setTimeout(() => {
        pendingSave = null
        void saveLocaleToServer(getCurrentPrefs())
      }, 1500)
    },
    { flush: 'sync' },
  )

  if (!pagehideRegistered && typeof window !== 'undefined') {
    pagehideRegistered = true
    window.addEventListener('pagehide', flushPendingSave)
  }
}
