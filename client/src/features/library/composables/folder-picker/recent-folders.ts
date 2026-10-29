import { normalizeFolderPath } from '../folder-paths'
import { parentPath } from './folder-picker-rules'

const STORAGE_KEY = 'bookorbit:folder-picker:recent'
const LIMIT = 5

/** Folders the picker last added from, newest first, in this browser. */
export function readRecentFolders(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(stored) ? stored.filter((value): value is string => typeof value === 'string').slice(0, LIMIT) : []
  } catch {
    return []
  }
}

/** Remembers where the added folders sit, so the next picker can jump back there. */
export function rememberRecentFolders(added: string[]) {
  const parents = added.map((path) => parentPath(normalizeFolderPath(path))).filter((path) => path !== '/')
  const next = [...new Set([...parents, ...readRecentFolders()])].slice(0, LIMIT)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Private windows forget it.
  }
}
