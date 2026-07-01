import { isSupportedLocale, type Locale, type LocalePreferences } from '@bookorbit/types'
import { watch } from 'vue'
import { toast } from 'vue-sonner'
import { useAuth } from '@/features/auth/composables/useAuth'
import { api, getAccessToken } from '@/lib/api'
import { useLocaleStore } from '@/stores/locale'

let initialized = false
let isApplyingServerPrefs = false
let pendingSave: ReturnType<typeof setTimeout> | null = null
let pagehideRegistered = false

function isSyncEnabled(): boolean {
  const { user } = useAuth()
  return user.value?.settings?.syncThemePreferences === true
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
  if (pendingSave === null || !isSyncEnabled()) return

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

export async function loadLocaleFromServer(): Promise<void> {
  try {
    const res = await api('/api/v1/user-preferences/locale')
    if (!res.ok) return

    const body = (await res.json()) as { settings: unknown }
    const locale = sanitizeServerPrefs(body.settings)
    if (locale === null) return

    const store = useLocaleStore()
    isApplyingServerPrefs = true
    try {
      // Apply without persisting locally; the server copy is the source of truth while syncing.
      await store.setLocale(locale, false)
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
  if (!isSyncEnabled()) return

  try {
    const res = await api('/api/v1/user-preferences/locale', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: prefs }),
    })

    if (!res.ok) {
      toast.error('Failed to save language preference')
    }
  } catch {
    toast.error('Failed to save language preference')
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
      if (isApplyingServerPrefs || !isSyncEnabled()) return

      if (pendingSave !== null) clearTimeout(pendingSave)
      pendingSave = setTimeout(() => {
        pendingSave = null
        void saveLocaleToServer(getCurrentPrefs())
      }, 1500)
    },
  )

  if (!pagehideRegistered && typeof window !== 'undefined') {
    pagehideRegistered = true
    window.addEventListener('pagehide', flushPendingSave)
  }
}
