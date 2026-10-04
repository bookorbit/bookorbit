import type { OrganizationMode } from '@bookorbit/types'
import type { NamingTarget } from './naming-rules'

/**
 * A pattern read as the path it builds: one entry per folder, then the file name.
 *
 * `folder` ends in a top-level slash. `optional` is a whole folder wrapped in an optional group,
 * such as `<{series}/>`, which the resolver drops when a value inside it is missing. The pieces
 * concatenate back to the exact pattern, so the field can draw one level per line without
 * changing a single character of what is saved.
 */
export type PatternLevelKind = 'folder' | 'optional' | 'file'

export interface PatternLevel {
  text: string
  kind: PatternLevelKind
  /** Folder as Book keeps each book in a folder of its own: the last folder before the file. */
  bookFolder: boolean
}

export function splitPatternLevels(pattern: string): Omit<PatternLevel, 'bookFolder'>[] {
  const levels: Omit<PatternLevel, 'bookFolder'>[] = []
  let depth = 0
  let start = 0
  let index = 0

  while (index < pattern.length) {
    const char = pattern.charAt(index)

    if (char === '<' && depth === 0 && start === index) {
      const close = pattern.indexOf('>', index)
      if (close !== -1) {
        const inner = pattern.slice(index + 1, close)
        if (isWholeOptionalFolder(inner)) {
          levels.push({ text: pattern.slice(index, close + 1), kind: 'optional' })
          index = close + 1
          start = index
          continue
        }
      }
    }

    if (char === '<') depth += 1
    else if (char === '>' && depth > 0) depth -= 1
    else if (char === '/' && depth === 0) {
      levels.push({ text: pattern.slice(start, index + 1), kind: 'folder' })
      start = index + 1
    }
    index += 1
  }

  levels.push({ text: pattern.slice(start), kind: 'file' })
  return levels
}

/** `{series}/` inside a group, with nothing else that would make the group more than one folder. */
function isWholeOptionalFolder(inner: string): boolean {
  if (!inner.endsWith('/')) return false
  const body = inner.slice(0, -1)
  return body.length > 0 && !/[/|<]/.test(body)
}

/** Downloads have no folders, so their pattern is always a single level. */
export function patternLevels(pattern: string, mode: OrganizationMode | null, target: NamingTarget): PatternLevel[] {
  if (target === 'download') return [{ text: pattern, kind: 'file', bookFolder: false }]
  const levels = splitPatternLevels(pattern).map((level) => ({ ...level, bookFolder: false }))
  if (mode === 'book_per_folder') {
    for (let index = levels.length - 2; index >= 0; index -= 1) {
      if (levels[index]?.kind === 'folder') {
        levels[index]!.bookFolder = true
        break
      }
    }
  }
  return levels
}

/* ───────────── line-per-level display ─────────────
 * The field shows the pattern with a newline after every level. Those newlines exist only on
 * screen: the saved value is the pattern with them removed, so offsets have to be translated
 * between the two whenever the caret is read or restored.
 */
export function displayText(levels: PatternLevel[]): string {
  return levels.map((level) => level.text).join('\n')
}

export function stripDisplayNewlines(display: string): string {
  return display.replace(/[\r\n]/g, '')
}

/** A display offset becomes a pattern offset by dropping the newlines before it. */
export function patternOffset(display: string, displayOffset: number): number {
  const before = display.slice(0, displayOffset)
  return displayOffset - (before.match(/\n/g)?.length ?? 0)
}

/**
 * A pattern offset sitting exactly on a level boundary lands at the start of the next line, which
 * is where typing continues after a slash that just opened a new folder.
 */
export function displayOffset(levels: PatternLevel[], patternOffsetValue: number): number {
  let boundary = 0
  let newlines = 0
  for (let index = 0; index < levels.length - 1; index += 1) {
    boundary += levels[index]!.text.length
    if (boundary <= patternOffsetValue) newlines += 1
  }
  return patternOffsetValue + newlines
}

/**
 * Backspace at the start of a line joins it to the line above, which in the pattern means removing
 * the separator that ended that level: the slash of `{a}/`, or the slash inside `<{a}/>`.
 */
export function joinWithPreviousLevel(pattern: string, patternOffsetValue: number): { pattern: string; offset: number } | null {
  if (patternOffsetValue <= 0) return null
  const before = pattern.charAt(patternOffsetValue - 1)
  if (before === '/') {
    return { pattern: pattern.slice(0, patternOffsetValue - 1) + pattern.slice(patternOffsetValue), offset: patternOffsetValue - 1 }
  }
  if (before === '>' && pattern.charAt(patternOffsetValue - 2) === '/') {
    const cut = patternOffsetValue - 2
    return { pattern: pattern.slice(0, cut) + pattern.slice(cut + 1), offset: patternOffsetValue - 1 }
  }
  return null
}

/* ───────────── skip a folder when it would be empty ───────────── */

/**
 * Only a folder that is a plain run of tokens and text can be wrapped: the resolver does not nest
 * optional groups, and a folder that already has a fallback can never be empty.
 */
export function canToggleOptional(level: PatternLevel): boolean {
  if (level.kind === 'optional') return true
  if (level.kind !== 'folder' || level.bookFolder) return false
  const body = level.text.slice(0, -1)
  return body.length > 0 && !/[<>|]/.test(body)
}

/** Wraps a folder as `<…/>` or unwraps it again, leaving every other level untouched. */
export function toggleOptionalLevel(levels: PatternLevel[], index: number): string | null {
  const level = levels[index]
  if (!level || !canToggleOptional(level)) return null
  const next = level.kind === 'optional' ? `${level.text.slice(1, -2)}/` : `<${level.text}>`
  return levels.map((entry, position) => (position === index ? next : entry.text)).join('')
}
