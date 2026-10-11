import {
  ACCENT_IDS,
  BACKGROUND_IDS,
  GLOW_REACH_MAX,
  GLOW_REACH_MIN,
  RADIUS_IDS,
  STYLE_IDS,
  SURFACE_OPACITY_MAX,
  SURFACE_OPACITY_MIN,
  SURFACE_PALETTE_IDS,
  THEME_IDS,
  type ThemePreferences,
} from '@bookorbit/types'
import { watch } from 'vue'
import { toast } from 'vue-sonner'
import { i18n } from '@/i18n'
import { useAuth } from '@/features/auth/composables/useAuth'
import { api, getAccessToken } from '@/lib/api'
import { useThemeStore } from '@/stores/theme'

let initialized = false
let isApplyingServerPrefs = false
let pendingSave: ReturnType<typeof setTimeout> | null = null
let pagehideRegistered = false

function getCurrentPrefs(): ThemePreferences {
  const store = useThemeStore()

  return {
    theme: store.theme,
    accent: store.accent,
    radius: store.radius,
    background: store.background,
    brightness: store.brightness,
    surfaceOpacity: store.surfaceOpacity,
    style: store.style,
    surfacePalette: store.surfacePalette,
    glowReach: store.glowReach,
  }
}

function isSyncEnabled(): boolean {
  const { user } = useAuth()
  return user.value?.settings?.syncThemePreferences === true
}

function sanitizeServerPrefs(raw: unknown): Partial<ThemePreferences> {
  if (typeof raw !== 'object' || raw === null) return {}

  const obj = raw as Record<string, unknown>
  const out: Partial<ThemePreferences> = {}

  if (THEME_IDS.includes(obj.theme as ThemePreferences['theme'])) out.theme = obj.theme as ThemePreferences['theme']
  if (ACCENT_IDS.includes(obj.accent as ThemePreferences['accent'])) out.accent = obj.accent as ThemePreferences['accent']
  if (RADIUS_IDS.includes(obj.radius as ThemePreferences['radius'])) out.radius = obj.radius as ThemePreferences['radius']
  if (BACKGROUND_IDS.includes(obj.background as ThemePreferences['background'])) out.background = obj.background as ThemePreferences['background']
  if (typeof obj.brightness === 'number' && Number.isInteger(obj.brightness) && obj.brightness >= 0 && obj.brightness <= 100) {
    out.brightness = obj.brightness
  }
  if (
    typeof obj.surfaceOpacity === 'number' &&
    Number.isInteger(obj.surfaceOpacity) &&
    obj.surfaceOpacity >= SURFACE_OPACITY_MIN &&
    obj.surfaceOpacity <= SURFACE_OPACITY_MAX
  ) {
    out.surfaceOpacity = obj.surfaceOpacity
  }
  if (STYLE_IDS.includes(obj.style as NonNullable<ThemePreferences['style']>)) out.style = obj.style as ThemePreferences['style']
  if (SURFACE_PALETTE_IDS.includes(obj.surfacePalette as NonNullable<ThemePreferences['surfacePalette']>)) {
    out.surfacePalette = obj.surfacePalette as ThemePreferences['surfacePalette']
  }
  if (typeof obj.glowReach === 'number' && Number.isInteger(obj.glowReach) && obj.glowReach >= GLOW_REACH_MIN && obj.glowReach <= GLOW_REACH_MAX) {
    out.glowReach = obj.glowReach
  }

  return out
}

function flushPendingSave(): void {
  if (pendingSave === null || !isSyncEnabled()) return

  clearTimeout(pendingSave)
  pendingSave = null

  const accessToken = getAccessToken()
  if (!accessToken) return

  void fetch('/api/v1/user-preferences/theme', {
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

export async function loadFromServer(): Promise<void> {
  try {
    const res = await api('/api/v1/user-preferences/theme')
    if (!res.ok) return

    const body = (await res.json()) as { settings: unknown }
    if (body.settings === null || body.settings === undefined) return

    const prefs = sanitizeServerPrefs(body.settings)
    const store = useThemeStore()

    isApplyingServerPrefs = true
    try {
      if (prefs.theme !== undefined) store.setTheme(prefs.theme)
      if (prefs.accent !== undefined) store.setAccent(prefs.accent)
      if (prefs.radius !== undefined) store.setRadius(prefs.radius)
      if (prefs.background !== undefined) store.setBackground(prefs.background)
      if (prefs.brightness !== undefined) store.setBrightness(prefs.brightness)
      if (prefs.surfaceOpacity !== undefined) store.setSurfaceOpacity(prefs.surfaceOpacity)
      if (prefs.style !== undefined) store.setStyle(prefs.style)
      if (prefs.surfacePalette !== undefined) store.setSurfacePalette(prefs.surfacePalette)
      if (prefs.glowReach !== undefined) store.setGlowReach(prefs.glowReach)
    } finally {
      isApplyingServerPrefs = false
    }
  } catch {
    // Silent on startup.
  }
}

export async function seedToServer(prefs: ThemePreferences): Promise<void> {
  try {
    await api('/api/v1/user-preferences/theme', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: prefs }),
    })
  } catch {
    // Silent seed failure.
  }
}

export async function saveToServer(prefs: ThemePreferences): Promise<void> {
  if (!isSyncEnabled()) return

  try {
    const res = await api('/api/v1/user-preferences/theme', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: prefs }),
    })

    if (!res.ok) toast.error(i18n.global.t('settings.appearance.theme.syncSaveFailed'))
  } catch {
    toast.error(i18n.global.t('settings.appearance.theme.syncSaveFailed'))
  }
}

export function cancelPendingThemeSync(): void {
  if (pendingSave !== null) {
    clearTimeout(pendingSave)
    pendingSave = null
  }
}

export function initThemeSync(): void {
  if (initialized) return
  initialized = true

  const store = useThemeStore()

  watch(
    () =>
      [
        store.theme,
        store.accent,
        store.radius,
        store.background,
        store.brightness,
        store.surfaceOpacity,
        store.style,
        store.surfacePalette,
        store.glowReach,
      ] as const,
    () => {
      if (isApplyingServerPrefs || !isSyncEnabled()) return

      if (pendingSave !== null) clearTimeout(pendingSave)
      pendingSave = setTimeout(() => {
        pendingSave = null
        void saveToServer(getCurrentPrefs())
      }, 1500)
    },
    { flush: 'sync' },
  )

  if (!pagehideRegistered && typeof window !== 'undefined') {
    pagehideRegistered = true
    window.addEventListener('pagehide', flushPendingSave)
  }
}
