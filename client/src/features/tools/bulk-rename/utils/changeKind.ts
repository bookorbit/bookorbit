import { diffPath, type PathRow } from './pathDiff'

/**
 * Fifty pending renames are rarely fifty decisions. They are usually a handful of decisions
 * applied fifty times, so the review queue groups by the *kind* of edit rather than by book.
 *
 * Keys are stable and map to locale messages under `tools.bulkRename.changeKind`.
 */
export type ChangeKindKey =
  | 'ungroup'
  | 'flatten'
  | 'yearRemoved'
  | 'yearAdded'
  | 'yearCorrected'
  | 'authorSpelling'
  | 'capitalisation'
  | 'unsafeCharacters'
  | 'filenameRebuilt'
  | 'folderRenamed'
  | 'rebuilt'
  | 'restructured'
  | 'multiple'

export interface ChangeKind {
  key: ChangeKindKey
  /** Values interpolated into the locale message for this kind, when it takes any. */
  detail: string
}

const INDEX = /^\d+\.$/
const UNSAFE = /[:?*"<>|]/

function uniqueTrimmed(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

/**
 * Buckets a rename by what actually changed.
 *
 * The order matters: the specific, explainable cases are tested before the vaguer ones, so a
 * row only falls through to `multiple` when nothing better describes it.
 */
export function classifyChange(fromPath: string, toPath: string): ChangeKind {
  const rows = diffPath(fromPath, toPath)
  const removedSegments = rows.filter((row) => row.kind === 'del')
  const addedSegments = rows.filter((row) => row.kind === 'ins')
  const edits = rows.filter((row) => row.kind === 'edit')

  const fromDepth = rows.filter((row) => row.kind !== 'ins').length
  const toDepth = rows.filter((row) => row.kind !== 'del').length
  const depth = `${fromDepth} → ${toDepth}`

  const removedText: string[] = []
  const addedText: string[] = []
  for (const edit of edits) {
    for (const op of edit.ops ?? []) {
      if (op.kind === 'del') removedText.push(op.value)
      else if (op.kind === 'ins') addedText.push(op.value)
    }
  }
  const removed = uniqueTrimmed(removedText)
  const added = uniqueTrimmed(addedText)

  if (removedSegments.length && !addedSegments.length) {
    if (removed.length && removed.every((value) => INDEX.test(value)) && !added.length) {
      return { key: 'ungroup', detail: depth }
    }
    if (!edits.length) return { key: 'flatten', detail: depth }
  }

  if (!removedSegments.length && !addedSegments.length && edits.length) {
    // Year checks compare whole segments, not character runs: a corrected year narrows to the
    // digits that differ, so `(1983)` against `(1976)` never appears intact in the run list.
    const yearOf = (value: string | null): string | null => value?.match(/\((\d{4})\)/)?.[1] ?? null
    const withoutYear = (value: string | null): string => (value ?? '').replace(/\s*\(\d{4}\)/g, '')

    if (edits.every((edit) => withoutYear(edit.from) === withoutYear(edit.to))) {
      const before = yearOf(edits[0]!.from)
      const after = yearOf(edits[0]!.to)
      if (before && !after) return { key: 'yearRemoved', detail: `(${before})` }
      if (!before && after) return { key: 'yearAdded', detail: `(${after})` }
      if (before && after && before !== after) return { key: 'yearCorrected', detail: `${before} → ${after}` }
    }

    const first = edits[0]!
    const index = rows.indexOf(first)
    // Spacing and punctuation-only differences are one bucket: `J. K. Rowling` and
    // `Helen  Fitzgerald` are the same class of fix as `Fitzgerald` losing a capital.
    const squash = (value: string): string => value.toLowerCase().replace(/\s+/g, '')
    if (edits.every((edit) => squash(edit.from ?? '') === squash(edit.to ?? ''))) {
      return { key: index === 0 ? 'authorSpelling' : 'capitalisation', detail: `${first.from} → ${first.to}` }
    }
    if (edits.some((edit) => UNSAFE.test(edit.from ?? ''))) {
      return { key: 'unsafeCharacters', detail: '' }
    }
    if (edits.length === 1) {
      const isLeaf = index === rows.length - 1
      return { key: isLeaf ? 'filenameRebuilt' : 'folderRenamed', detail: `${first.from} → ${first.to}` }
    }
    return { key: 'rebuilt', detail: String(edits.length) }
  }

  if (removedSegments.length && edits.length) return { key: 'restructured', detail: depth }
  return { key: 'multiple', detail: String(removedSegments.length + addedSegments.length + edits.length) }
}

/** A naming pattern split on the slashes that sit outside any `<optional>` group. */
export function patternSegments(pattern: string): string[] {
  const out: string[] = []
  let depth = 0
  let current = ''
  for (const ch of pattern) {
    if (ch === '<') depth++
    else if (ch === '>') depth--
    if (ch === '/' && depth === 0) {
      out.push(current)
      current = ''
      continue
    }
    current += ch
  }
  out.push(current)
  return out
}

export interface ChangeReason {
  row: PathRow
  /** `top` for the first folder, `filename` for the leaf, `removed` for a dropped level. */
  level: 'top' | 'folder' | 'filename' | 'removed'
  /** One-based depth of the destination segment, for the folder label. */
  depth: number
  /** The pattern segment that produced this level, when it can be identified. */
  source: string | null
  tokens: string[]
}

/**
 * Ties each changed path segment back to the pattern segment that produced it, so the detail
 * pane can answer "why is this moving" rather than printing the raw pattern and leaving the
 * reader to work it out.
 *
 * The ends are anchored and the middle stays quiet: the first destination segment is always the
 * pattern's first segment and the last is always its last, but when the depths differ the extra
 * level in between comes from an optional group, and guessing which segment produced it would be
 * worse than saying nothing.
 */
export function explainChange(fromPath: string, toPath: string, pattern: string): ChangeReason[] {
  const rows = diffPath(fromPath, toPath)
  const segments = patternSegments(pattern)
  const destinationCount = rows.filter((row) => row.kind !== 'del').length

  const sourceFor = (index: number): string | null => {
    if (index === 0) return segments[0] ?? null
    if (index === destinationCount - 1) return segments[segments.length - 1] ?? null
    if (destinationCount === segments.length) return segments[index] ?? null
    return null
  }

  const out: ChangeReason[] = []
  let index = -1
  for (const row of rows) {
    if (row.kind !== 'del') index++
    if (row.kind === 'eq') continue

    if (row.kind === 'del') {
      out.push({ row, level: 'removed', depth: 0, source: null, tokens: [] })
      continue
    }

    const source = sourceFor(index)
    const level = index === destinationCount - 1 ? 'filename' : index === 0 ? 'top' : 'folder'
    out.push({
      row,
      level,
      depth: index + 1,
      source,
      tokens: source ? [...new Set(source.match(/\{[^}]+\}/g) ?? [])] : [],
    })
  }
  return out
}
