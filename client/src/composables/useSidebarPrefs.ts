import { reactive, watch } from 'vue'
import {
  SIDEBAR_CAP_OPTIONS,
  SIDEBAR_DEFAULT_CAP,
  SIDEBAR_SECTION_IDS,
  type SidebarCap,
  type SidebarConfig,
  type SidebarSectionId,
  type SidebarSectionState,
} from '@bookorbit/types'
import { api } from '@/lib/api'
import { storage } from '@/services/storage'
import { useAuth } from '@/features/auth/composables/useAuth'

const PERSIST_DEBOUNCE_MS = 600

/** Section open/closed state predating the account-scoped sidebarConfig blob. */
const LEGACY_SECTION_KEYS: Record<SidebarSectionId, string> = {
  libraries: 'bookorbit:sidebar:libraries',
  smartScopes: 'bookorbit:sidebar:smart-scopes',
  collections: 'bookorbit:sidebar:collections',
}

export const LEGACY_SIDEBAR_WIDTH_KEY = 'bookorbit:sidebar:width'

function defaultSections(): Record<SidebarSectionId, SidebarSectionState> {
  return {
    libraries: { open: true, cap: SIDEBAR_DEFAULT_CAP },
    smartScopes: { open: true, cap: SIDEBAR_DEFAULT_CAP },
    collections: { open: true, cap: SIDEBAR_DEFAULT_CAP },
  }
}

export function clampCap(value: unknown): SidebarCap {
  return (SIDEBAR_CAP_OPTIONS as readonly unknown[]).includes(value) ? (value as SidebarCap) : SIDEBAR_DEFAULT_CAP
}

/** The settings blob accepts arbitrary keys, so every field is re-checked on read. */
export function parseSidebarConfig(raw: unknown): Record<SidebarSectionId, SidebarSectionState> {
  const sections = defaultSections()
  if (typeof raw !== 'object' || raw === null) return sections

  const storedSections = (raw as { sections?: unknown }).sections
  if (typeof storedSections !== 'object' || storedSections === null) return sections

  for (const id of SIDEBAR_SECTION_IDS) {
    const stored = (storedSections as Record<string, unknown>)[id]
    if (typeof stored !== 'object' || stored === null) continue
    const entry = stored as { open?: unknown; cap?: unknown }
    sections[id] = {
      open: entry.open !== false,
      cap: clampCap(entry.cap),
    }
  }
  return sections
}

export function userScopedKey(userId: number | null | undefined, suffix: string): string {
  return userId ? `bookorbit:u${userId}:sidebar:${suffix}` : `bookorbit:sidebar:${suffix}`
}

const sections = reactive(defaultSections())

let hydratedForUserId: number | null = null
let persistTimer: ReturnType<typeof setTimeout> | null = null
let suppressPersist = false

function currentConfig(): SidebarConfig {
  return { sections: { ...sections } }
}

async function persistNow(): Promise<void> {
  const { user, me } = useAuth()
  if (!user.value) return

  const config = currentConfig()
  try {
    const res = await api('/api/v1/users/me/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { sidebarConfig: config } }),
    })
    if (!res.ok) return
    await me()
  } catch {
    // Section state is a convenience; a failed write retries on the next change.
  }
}

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    void persistNow()
  }, PERSIST_DEBOUNCE_MS)
}

/** Seeds sidebarConfig from the pre-account localStorage keys, then removes them.
 *  Those keys were written without a user scope, so two accounts in one browser shared them. */
function migrateLegacySectionKeys(userId: number): boolean {
  let migrated = false
  for (const id of SIDEBAR_SECTION_IDS) {
    const legacyKey = LEGACY_SECTION_KEYS[id]
    const stored = storage.get<unknown>(legacyKey, undefined)
    if (stored === undefined) continue
    sections[id].open = stored !== false
    storage.remove(legacyKey)
    migrated = true
  }

  const legacyWidth = storage.get<unknown>(LEGACY_SIDEBAR_WIDTH_KEY, undefined)
  if (typeof legacyWidth === 'number') {
    const scopedKey = userScopedKey(userId, 'width')
    if (storage.get<unknown>(scopedKey, undefined) === undefined) storage.set(scopedKey, legacyWidth)
    storage.remove(LEGACY_SIDEBAR_WIDTH_KEY)
  }

  return migrated
}

function hydrate(): void {
  const { user } = useAuth()
  const userId = user.value?.id ?? null
  if (userId === null || userId === hydratedForUserId) return

  hydratedForUserId = userId
  suppressPersist = true
  Object.assign(sections, parseSidebarConfig(user.value?.settings?.sidebarConfig))
  const migrated = migrateLegacySectionKeys(userId)
  suppressPersist = false

  if (migrated) schedulePersist()
}

let watcherStarted = false

export function useSidebarPrefs() {
  const { user } = useAuth()

  if (!watcherStarted) {
    watcherStarted = true
    watch(() => user.value?.id ?? null, hydrate, { immediate: true })
    watch(
      sections,
      () => {
        if (suppressPersist) return
        schedulePersist()
      },
      { deep: true },
    )
  } else {
    hydrate()
  }

  function setSectionOpen(id: SidebarSectionId, open: boolean): void {
    sections[id].open = open
  }

  function toggleSection(id: SidebarSectionId): void {
    sections[id].open = !sections[id].open
  }

  function setSectionCap(id: SidebarSectionId, cap: SidebarCap): void {
    sections[id].cap = clampCap(cap)
  }

  function readDeviceValue<T>(suffix: string, fallback: T): T {
    return storage.get<T>(userScopedKey(user.value?.id ?? null, suffix), fallback)
  }

  function writeDeviceValue<T>(suffix: string, value: T): void {
    storage.set(userScopedKey(user.value?.id ?? null, suffix), value)
  }

  return { sections, setSectionOpen, toggleSection, setSectionCap, readDeviceValue, writeDeviceValue }
}

/** Test seam: clears the module-level hydration state between specs. */
export function resetSidebarPrefs(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = null
  hydratedForUserId = null
  watcherStarted = false
  suppressPersist = false
  Object.assign(sections, defaultSections())
}
