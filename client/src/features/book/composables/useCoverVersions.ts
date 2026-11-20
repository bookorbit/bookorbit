import type { CoverMedium } from '@bookorbit/types'
import { ref } from 'vue'

const STORAGE_KEY = 'cover-versions-v2'
type CoverVersionInput = number | string | Date | null | undefined

function load(): Map<number, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Map()
    return new Map(JSON.parse(raw) as [number, number][])
  } catch {
    return new Map()
  }
}

function persist(map: Map<number, number>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...map]))
  } catch {
    // ignore quota errors
  }
}

const versions = ref<Map<number, number>>(load())

function normalizeVersion(value: CoverVersionInput): string | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? String(Math.trunc(value)) : undefined
  if (value instanceof Date) {
    const time = value.getTime()
    return Number.isFinite(time) && time > 0 ? String(time) : undefined
  }
  if (typeof value !== 'string') return undefined

  const trimmed = value.trim()
  if (!trimmed) return undefined
  const numeric = Number(trimmed)
  if (Number.isFinite(numeric) && numeric > 0) return String(Math.trunc(numeric))
  const parsed = Date.parse(trimmed)
  if (Number.isFinite(parsed) && parsed > 0) return String(parsed)
  return trimmed
}

function versionToken(localVersion: number | undefined, serverVersion: string | undefined): string | undefined {
  if (serverVersion !== undefined && localVersion !== undefined) return `${serverVersion}-${localVersion}`
  if (serverVersion !== undefined) return String(serverVersion)
  if (localVersion !== undefined) return String(localVersion)
  return undefined
}

export function useCoverVersions() {
  function bumpVersion(bookId: number) {
    const next = new Map(versions.value).set(bookId, Date.now())
    versions.value = next
    persist(next)
  }

  function getVersion(bookId: number): number | undefined {
    return versions.value.get(bookId)
  }

  /** `display` is the cover at the size a page shows it large; `cover` is the full image, for zooming in. */
  function coverUrl(
    bookId: number,
    type: 'thumbnail' | 'display' | 'cover' = 'thumbnail',
    sourceVersion?: CoverVersionInput,
    medium?: CoverMedium,
  ): string {
    const base = `/api/v1/books/${bookId}/${type === 'thumbnail' ? 'thumbnail' : 'cover'}`
    const localVersion = versions.value.get(bookId)
    const serverVersion = normalizeVersion(sourceVersion)
    const token = versionToken(localVersion, serverVersion)
    const params = new URLSearchParams()
    if (token) params.set('t', token)
    if (medium) params.set('medium', medium)
    if (type === 'display') params.set('size', 'display')
    const query = params.toString()
    return query ? `${base}?${query}` : base
  }

  return { getVersion, bumpVersion, coverUrl }
}
