import { computed, ref } from 'vue'
import { api } from '@/lib/api'
import { useAuth } from '@/features/auth/composables/useAuth'
import { type ReaderFormatGroup, type ReaderSettings, READER_GROUP_DEFAULTS, getFormatGroup } from '@projectx/types'

// -- Shared localStorage helpers --

const lsBookKey = (bookFileId: number) => `reader:book:${bookFileId}`
const lsDefaultKey = (group: ReaderFormatGroup) => `reader:default:${group}`

function readLs<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeLs(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value))
}

function removeLs(key: string): void {
  localStorage.removeItem(key)
}

// -- Per-book settings (used inside the reader) --

export function useReaderSettings(bookFileId: number, format: string) {
  const group = getFormatGroup(format)
  const { user } = useAuth()

  // Only the fields the user explicitly changed for this book — not a full snapshot.
  const bookDelta = ref<Partial<ReaderSettings> | null>(null)
  const defaultSettings = ref<ReaderSettings | null>(null)
  const isCustomized = ref(false)

  const syncEnabled = computed(() => user.value?.settings?.syncReaderPreferences === true)

  // Merge order: hardcoded fallback → format defaults → per-book delta
  const effective = computed<ReaderSettings>(
    () =>
      ({
        ...(READER_GROUP_DEFAULTS[group] as ReaderSettings),
        ...(defaultSettings.value ?? {}),
        ...(bookDelta.value ?? {}),
      }) as ReaderSettings,
  )

  async function load() {
    const lsBook = readLs<Partial<ReaderSettings>>(lsBookKey(bookFileId))
    const lsDefault = readLs<ReaderSettings>(lsDefaultKey(group))

    if (lsBook) {
      bookDelta.value = lsBook
      isCustomized.value = Object.keys(lsBook).length > 0
    }
    if (lsDefault) {
      defaultSettings.value = lsDefault
    }

    if (syncEnabled.value) {
      await syncFromDb()
    }
  }

  async function syncFromDb() {
    const [prefRes, defRes] = await Promise.all([
      api(`/api/reader/preferences/${bookFileId}`).then((r) => (r.ok ? r.json() : null)),
      api(`/api/reader/defaults`).then((r) => (r.ok ? r.json() : null)),
    ])

    if (prefRes?.settings) {
      bookDelta.value = prefRes.settings as Partial<ReaderSettings>
      isCustomized.value = Object.keys(prefRes.settings).length > 0
      writeLs(lsBookKey(bookFileId), prefRes.settings)
    }
    if (defRes?.[group]) {
      defaultSettings.value = defRes[group] as ReaderSettings
      writeLs(lsDefaultKey(group), defRes[group])
    }
  }

  // Merges only the changed field(s) into the existing delta — never saves a full snapshot.
  function updateBookSettings(patch: Partial<ReaderSettings>) {
    const next = { ...(bookDelta.value ?? {}), ...patch } as Partial<ReaderSettings>
    bookDelta.value = next
    isCustomized.value = Object.keys(next).length > 0
    writeLs(lsBookKey(bookFileId), next)

    if (syncEnabled.value) {
      api(`/api/reader/preferences/${bookFileId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: next }),
      }).catch(() => {})
    }
  }

  function resetBookSettings() {
    bookDelta.value = null
    isCustomized.value = false
    removeLs(lsBookKey(bookFileId))

    if (syncEnabled.value) {
      api(`/api/reader/preferences/${bookFileId}`, { method: 'DELETE' }).catch(() => {})
    }
  }

  function updateDefaultSettings(patch: Partial<ReaderSettings>) {
    const current = defaultSettings.value ?? READER_GROUP_DEFAULTS[group]
    const next = { ...current, ...patch } as ReaderSettings
    defaultSettings.value = next
    writeLs(lsDefaultKey(group), next)

    if (syncEnabled.value) {
      api(`/api/reader/defaults/${group}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: next }),
      }).catch(() => {})
    }
  }

  function resetDefaultSettings() {
    defaultSettings.value = null
    removeLs(lsDefaultKey(group))

    if (syncEnabled.value) {
      api(`/api/reader/defaults/${group}`, { method: 'DELETE' }).catch(() => {})
    }
  }

  return {
    effective,
    bookDelta,
    isCustomized,
    load,
    updateBookSettings,
    resetBookSettings,
    updateDefaultSettings,
    resetDefaultSettings,
  }
}

// -- Format default settings (used in the settings UI) --

export function useReaderDefaultSettings<T extends ReaderSettings>(format: string) {
  const group = getFormatGroup(format)
  const { user } = useAuth()

  const settings = ref<T | null>(null)
  const syncEnabled = computed(() => user.value?.settings?.syncReaderPreferences === true)
  const effective = computed<T>(() => (settings.value ?? READER_GROUP_DEFAULTS[group]) as T)

  async function load() {
    const ls = readLs<T>(lsDefaultKey(group))
    if (ls) settings.value = ls

    if (syncEnabled.value) {
      const res = await api('/api/reader/defaults')
      if (res.ok) {
        const data = await res.json()
        if (data[group]) {
          settings.value = data[group] as T
          writeLs(lsDefaultKey(group), data[group])
        }
      }
    }
  }

  function update(patch: Partial<T>) {
    const next = { ...effective.value, ...patch } as T
    settings.value = next
    writeLs(lsDefaultKey(group), next)

    if (syncEnabled.value) {
      api(`/api/reader/defaults/${group}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: next }),
      }).catch(() => {})
    }
  }

  function reset() {
    settings.value = null
    removeLs(lsDefaultKey(group))

    if (syncEnabled.value) {
      api(`/api/reader/defaults/${group}`, { method: 'DELETE' }).catch(() => {})
    }
  }

  return { effective, load, update, reset }
}
