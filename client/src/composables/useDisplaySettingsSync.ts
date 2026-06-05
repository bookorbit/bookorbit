import type { DisplayPreferences } from '@bookorbit/types'
import { watch } from 'vue'
import { toast } from 'vue-sonner'
import { useAuth } from '@/features/auth/composables/useAuth'
import { api, getAccessToken } from '@/lib/api'
import { applyDisplayPreferences, getDisplayPreferencesSnapshot, useDisplaySettings } from '@/composables/useDisplaySettings'

let initialized = false
let isApplyingServerPrefs = false
let pendingSave: ReturnType<typeof setTimeout> | null = null
let pagehideRegistered = false

function isSyncEnabled(): boolean {
  const { user } = useAuth()
  return user.value?.settings?.syncThemePreferences === true
}

function flushPendingSave(): void {
  if (pendingSave === null || !isSyncEnabled()) return

  clearTimeout(pendingSave)
  pendingSave = null

  const accessToken = getAccessToken()
  if (!accessToken) return

  void fetch('/api/v1/user-preferences/display', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    credentials: 'include',
    keepalive: true,
    body: JSON.stringify({ settings: getDisplayPreferencesSnapshot() }),
  })
}

export async function loadDisplaySettingsFromServer(): Promise<void> {
  try {
    const res = await api('/api/v1/user-preferences/display')
    if (!res.ok) return

    const body = (await res.json()) as { settings: unknown }
    if (body.settings === null || body.settings === undefined) return

    isApplyingServerPrefs = true
    try {
      applyDisplayPreferences(body.settings)
    } finally {
      isApplyingServerPrefs = false
    }
  } catch {
    // Silent on startup.
  }
}

export async function seedDisplaySettingsToServer(prefs: DisplayPreferences): Promise<void> {
  try {
    await api('/api/v1/user-preferences/display', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: prefs }),
    })
  } catch {
    // Silent seed failure.
  }
}

export async function saveDisplaySettingsToServer(prefs: DisplayPreferences): Promise<void> {
  if (!isSyncEnabled()) return

  try {
    const res = await api('/api/v1/user-preferences/display', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: prefs }),
    })

    if (!res.ok) {
      toast.error('Failed to save display preferences')
    }
  } catch {
    toast.error('Failed to save display preferences')
  }
}

export function cancelPendingDisplaySettingsSync(): void {
  if (pendingSave !== null) {
    clearTimeout(pendingSave)
    pendingSave = null
  }
}

export function initDisplaySettingsSync(): void {
  if (initialized) return
  initialized = true

  const settings = useDisplaySettings()

  watch(
    () =>
      [
        settings.portraitCoverSize.value,
        settings.squareCoverSize.value,
        settings.coverSizeScope.value,
        settings.gridGap.value,
        settings.portraitGridGap.value,
        settings.squareGridGap.value,
        settings.viewMode.value,
        settings.cardOverlays.value.join('\u0000'),
        settings.smartScopeFilterExpanded.value,
        settings.authorCoverSize.value,
        settings.authorCoverShape.value,
        settings.tableZebraStriping.value,
        settings.tableDensity.value,
        settings.bookSpineOverlay.value,
        settings.bookShadowStrength.value,
        settings.bookCoverDisplayMode.value,
        settings.seriesCardCoverMode.value,
        settings.gridCardPrimaryLabel.value,
        settings.gridCardSecondaryLabel.value,
        settings.cardInfoMode.value,
      ] as const,
    () => {
      if (isApplyingServerPrefs || !isSyncEnabled()) return

      if (pendingSave !== null) clearTimeout(pendingSave)
      pendingSave = setTimeout(() => {
        pendingSave = null
        void saveDisplaySettingsToServer(getDisplayPreferencesSnapshot())
      }, 1500)
    },
    { flush: 'sync' },
  )

  if (!pagehideRegistered && typeof window !== 'undefined') {
    pagehideRegistered = true
    window.addEventListener('pagehide', flushPendingSave)
  }
}
