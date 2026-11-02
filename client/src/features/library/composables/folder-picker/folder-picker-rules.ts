import type { FolderSummary, OrganizationMode } from '@bookorbit/types'
import { consolidateFolderPaths, normalizeFolderPath } from '../folder-paths'

export interface PickerLibrary {
  id: number | null
  name: string
  icon: string | null
  folders: string[]
  /** The library being created or edited. */
  self?: boolean
}

export type FolderStatusKind = 'denied' | 'appData' | 'own' | 'ownCovered' | 'selected' | 'included' | 'overlap' | 'contains'

export interface FolderStatus {
  kind: FolderStatusKind
  /** Ticking is refused. */
  block?: boolean
  /** Ticking is allowed but would put books in two libraries. */
  warn?: boolean
  /** For a ticked folder that overlaps: which overlap it is. */
  over?: 'overlap' | 'contains'
  /** The ticked or owned folder that includes this one. */
  cover?: string
  /** The library a folder sits in, or holds. */
  library?: PickerLibrary
  /** Every library a folder holds, for `contains`. */
  libraries?: PickerLibrary[]
  /** `overlap` at the library's own folder rather than below it. */
  exact?: boolean
}

export interface StatusContext {
  denied: boolean
  appData: boolean
  own: string[]
  selected: string[]
  others: PickerLibrary[]
}

export function isInside(path: string, parent: string): boolean {
  const a = normalizeFolderPath(path)
  const b = normalizeFolderPath(parent)
  return a !== b && (b === '/' ? a.startsWith('/') : a.startsWith(`${b}/`))
}

export function isAtOrInside(path: string, parent: string): boolean {
  return normalizeFolderPath(path) === normalizeFolderPath(parent) || isInside(path, parent)
}

export function parentPath(path: string): string {
  const parts = normalizeFolderPath(path).split('/').filter(Boolean)
  parts.pop()
  return parts.length ? `/${parts.join('/')}` : '/'
}

/** Folders between `root` (exclusive) and `path` (exclusive), outermost first. */
export function ancestorsWithin(path: string, root: string): string[] {
  const top = normalizeFolderPath(root)
  const out: string[] = []
  for (let parent = parentPath(path); parent !== top && parent !== '/' && isInside(parent, top); parent = parentPath(parent)) out.unshift(parent)
  return out
}

export function leafName(path: string): string {
  const normalized = normalizeFolderPath(path)
  return normalized === '/' ? '/' : normalized.slice(normalized.lastIndexOf('/') + 1)
}

/** Another library already reading this folder, a folder around it, or a folder inside it. */
export function overlapStatus(path: string, others: PickerLibrary[]): FolderStatus | null {
  const at = others.find((library) => library.folders.some((folder) => normalizeFolderPath(folder) === normalizeFolderPath(path)))
  if (at) return { kind: 'overlap', warn: true, library: at, exact: true }
  const around = others.find((library) => library.folders.some((folder) => isInside(path, folder)))
  if (around) return { kind: 'overlap', warn: true, library: around, exact: false }
  const within = others.filter((library) => library.folders.some((folder) => isInside(folder, path)))
  if (within.length > 0) return { kind: 'contains', warn: true, library: within[0], libraries: within }
  return null
}

/** One status per folder, the first that applies. */
export function folderStatus(path: string, context: StatusContext): FolderStatus | null {
  const normalized = normalizeFolderPath(path)
  if (context.denied) return { kind: 'denied', block: true }
  if (context.appData) return { kind: 'appData', block: true }
  if (context.own.some((folder) => normalizeFolderPath(folder) === normalized)) return { kind: 'own', block: true }
  const ownCover = context.own.find((folder) => isInside(normalized, folder))
  if (ownCover) return { kind: 'ownCovered', block: true, cover: normalizeFolderPath(ownCover) }
  // A ticked folder keeps its overlap warning: ticking it is exactly when the warning matters.
  const overlap = overlapStatus(normalized, context.others)
  if (context.selected.includes(normalized))
    return overlap ? { ...overlap, kind: 'selected', over: overlap.kind as 'overlap' | 'contains' } : { kind: 'selected' }
  const selectedCover = context.selected.find((folder) => isInside(normalized, folder))
  if (selectedCover) return { kind: 'included', block: true, cover: selectedCover }
  return overlap
}

export interface ToggleResult {
  selected: string[]
  /** Picks folded into the newly ticked parent. */
  folded: string[]
}

export function toggleFolder(selected: string[], path: string): ToggleResult {
  const normalized = normalizeFolderPath(path)
  if (selected.includes(normalized)) return { selected: selected.filter((folder) => folder !== normalized), folded: [] }
  const folded = selected.filter((folder) => isInside(folder, normalized))
  return { selected: consolidateFolderPaths([...selected, normalized]).sort(), folded }
}

/** Books the library would import from a folder in each organization mode. */
export function booksAs(summary: FolderSummary | undefined, mode: OrganizationMode): number {
  if (!summary) return 0
  return mode === 'book_per_file' ? summary.files : summary.folderBooks
}

export type AttentionKind = 'contains' | 'overlap' | 'merge' | 'split'

export interface Attention {
  kind: AttentionKind
  status?: FolderStatus
}

/** What a picked folder needs before it is added, or null when it is fine as it is. */
export function attentionFor(summary: FolderSummary | undefined, status: FolderStatus | null, mode: OrganizationMode): Attention | null {
  if (status?.warn) return { kind: status.over === 'contains' ? 'contains' : 'overlap', status }
  if (!summary) return null
  if (mode === 'book_per_folder' && summary.mergedFolders > 0) return { kind: 'merge' }
  if (mode === 'book_per_file' && summary.splitAudioFolders > 0) return { kind: 'split' }
  return null
}

/** Siblings from `from` to `to`, inclusive, in list order. */
export function rangeBetween(siblings: string[], from: string, to: string): string[] {
  const a = siblings.indexOf(from)
  const b = siblings.indexOf(to)
  if (a < 0 || b < 0) return []
  const [lo, hi] = a < b ? [a, b] : [b, a]
  return siblings.slice(lo, hi + 1)
}
