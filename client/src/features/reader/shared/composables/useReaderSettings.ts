import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import { useAuth } from '@/features/auth/composables/useAuth'
import {
  CBX_READER_DEFAULTS,
  type CbxReaderSettings,
  type ReaderFormatGroup,
  type ReaderSettings,
  READER_GROUP_DEFAULTS,
  getFormatGroup,
} from '@projectx/types'

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function sanitizeCbxPartialSettings(settings: unknown): Partial<CbxReaderSettings> | null {
  if (!isRecord(settings)) return null

  const out: Partial<CbxReaderSettings> = {}

  if (settings.fitMode === 'fit-page' || settings.fitMode === 'fit-width' || settings.fitMode === 'fit-height' || settings.fitMode === 'actual') {
    out.fitMode = settings.fitMode
  }
  if (settings.viewMode === 'single' || settings.viewMode === 'two-page') {
    out.viewMode = settings.viewMode
  }
  if (settings.scrollMode === 'paginated' || settings.scrollMode === 'infinite' || settings.scrollMode === 'long-strip') {
    out.scrollMode = settings.scrollMode
  }
  if (settings.direction === 'ltr' || settings.direction === 'rtl') {
    out.direction = settings.direction
  }
  if (settings.spreadAlignment === 'normal' || settings.spreadAlignment === 'shifted') {
    out.spreadAlignment = settings.spreadAlignment
  }
  if (typeof settings.forceTwoPage === 'boolean') {
    out.forceTwoPage = settings.forceTwoPage
  }
  if (settings.widePageSingletonMode === 'auto' || settings.widePageSingletonMode === 'disable') {
    out.widePageSingletonMode = settings.widePageSingletonMode
  }
  if (settings.bgColor === 'black' || settings.bgColor === 'gray' || settings.bgColor === 'white') {
    out.bgColor = settings.bgColor
  }

  return out
}

function sanitizeBookDelta(group: ReaderFormatGroup, raw: unknown): Partial<ReaderSettings> | null {
  if (group !== 'cbx') return isRecord(raw) ? (raw as Partial<ReaderSettings>) : null
  const sanitized = sanitizeCbxPartialSettings(raw)
  return sanitized as Partial<ReaderSettings> | null
}

function sanitizeDefaultSettings(group: ReaderFormatGroup, raw: unknown): ReaderSettings | null {
  if (group !== 'cbx') return isRecord(raw) ? (raw as unknown as ReaderSettings) : null

  const sanitized = sanitizeCbxPartialSettings(raw)
  if (!sanitized) return null

  return {
    ...CBX_READER_DEFAULTS,
    ...sanitized,
  } as ReaderSettings
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
        ...(defaultSettings.value ?? undefined),
        ...(bookDelta.value ?? undefined),
      }) as ReaderSettings,
  )

  async function load() {
    const lsBook = readLs<Partial<ReaderSettings>>(lsBookKey(bookFileId))
    const lsDefault = readLs<ReaderSettings>(lsDefaultKey(group))

    if (lsBook) {
      const sanitized = sanitizeBookDelta(group, lsBook)
      if (sanitized && Object.keys(sanitized).length > 0) {
        bookDelta.value = sanitized
        isCustomized.value = true
        if (!jsonEqual(lsBook, sanitized)) writeLs(lsBookKey(bookFileId), sanitized)
      } else {
        bookDelta.value = null
        isCustomized.value = false
        removeLs(lsBookKey(bookFileId))
      }
    }
    if (lsDefault) {
      const sanitized = sanitizeDefaultSettings(group, lsDefault)
      if (sanitized) {
        defaultSettings.value = sanitized
        if (!jsonEqual(lsDefault, sanitized)) writeLs(lsDefaultKey(group), sanitized)
      } else {
        defaultSettings.value = null
        removeLs(lsDefaultKey(group))
      }
    }

    if (syncEnabled.value) {
      await syncFromDb()
    }
  }

  async function syncFromDb() {
    const [prefRes, defRes] = await Promise.all([
      api(`/api/v1/reader/preferences/${bookFileId}`).then((r) => (r.ok ? r.json() : null)),
      api(`/api/v1/reader/defaults`).then((r) => (r.ok ? r.json() : null)),
    ])

    if (prefRes?.settings) {
      const sanitized = sanitizeBookDelta(group, prefRes.settings)
      if (sanitized && Object.keys(sanitized).length > 0) {
        bookDelta.value = sanitized
        isCustomized.value = true
        writeLs(lsBookKey(bookFileId), sanitized)
      } else {
        bookDelta.value = null
        isCustomized.value = false
        removeLs(lsBookKey(bookFileId))
      }
    }
    if (defRes?.[group]) {
      const sanitized = sanitizeDefaultSettings(group, defRes[group])
      if (sanitized) {
        defaultSettings.value = sanitized
        writeLs(lsDefaultKey(group), sanitized)
      } else {
        defaultSettings.value = null
        removeLs(lsDefaultKey(group))
      }
    }
  }

  // Merges only the changed field(s) into the existing delta — never saves a full snapshot.
  function updateBookSettings(patch: Partial<ReaderSettings>) {
    const next = { ...(bookDelta.value ?? undefined), ...patch } as Partial<ReaderSettings>
    bookDelta.value = next
    isCustomized.value = Object.keys(next).length > 0
    writeLs(lsBookKey(bookFileId), next)

    if (syncEnabled.value) {
      api(`/api/v1/reader/preferences/${bookFileId}`, {
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
      api(`/api/v1/reader/preferences/${bookFileId}`, { method: 'DELETE' }).catch(() => {})
    }
  }

  function updateDefaultSettings(patch: Partial<ReaderSettings>) {
    const current = defaultSettings.value ?? READER_GROUP_DEFAULTS[group]
    const next = { ...current, ...patch } as ReaderSettings
    defaultSettings.value = next
    writeLs(lsDefaultKey(group), next)

    if (syncEnabled.value) {
      api(`/api/v1/reader/defaults/${group}`, {
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
      api(`/api/v1/reader/defaults/${group}`, { method: 'DELETE' }).catch(() => {})
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
    if (ls) {
      const sanitized = sanitizeDefaultSettings(group, ls)
      if (sanitized) {
        settings.value = sanitized as T
        if (!jsonEqual(ls, sanitized)) writeLs(lsDefaultKey(group), sanitized)
      } else {
        settings.value = null
        removeLs(lsDefaultKey(group))
      }
    }

    if (syncEnabled.value) {
      const res = await api('/api/v1/reader/defaults')
      if (res.ok) {
        const data = await res.json()
        if (data[group]) {
          const sanitized = sanitizeDefaultSettings(group, data[group])
          if (sanitized) {
            settings.value = sanitized as T
            writeLs(lsDefaultKey(group), sanitized)
          } else {
            settings.value = null
            removeLs(lsDefaultKey(group))
          }
        }
      }
    }
  }

  function update(patch: Partial<T>) {
    const next = { ...effective.value, ...patch } as T
    settings.value = next
    writeLs(lsDefaultKey(group), next)

    if (syncEnabled.value) {
      api(`/api/v1/reader/defaults/${group}`, {
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
      api(`/api/v1/reader/defaults/${group}`, { method: 'DELETE' }).catch(() => {})
    }
    toast.success('Settings reset to defaults')
  }

  return { effective, load, update, reset }
}
