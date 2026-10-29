import { AUDIOBOOK_CHAPTER_LIMITS, type AudiobookChapter } from '@bookorbit/types'

/** A row in the editor. The key is stable across edits, so selection and focus survive reordering. */
export interface DraftChapter {
  key: string
  title: string
  startMs: number
}

export type ChapterIssueCode = 'emptyTitle' | 'firstNotZero' | 'notAscending' | 'pastEnd' | 'tooShort' | 'tooMany' | 'titleTooLong' | 'invalidStart'

export interface ChapterIssue {
  key: string
  index: number
  code: ChapterIssueCode
  severity: 'error' | 'warning'
}

/** Below this a chapter is almost certainly a stray marker rather than content. */
export const SHORT_CHAPTER_MS = 1_000

let keySequence = 0

export function nextChapterKey(): string {
  keySequence += 1
  return `ch${keySequence}`
}

export function toDraft(chapters: readonly AudiobookChapter[]): DraftChapter[] {
  return chapters.map((chapter) => ({ key: nextChapterKey(), title: chapter.title, startMs: chapter.startMs }))
}

export function fromDraft(draft: readonly DraftChapter[]): AudiobookChapter[] {
  return draft.map((chapter) => ({ title: chapter.title.trim(), startMs: Math.round(chapter.startMs) }))
}

/** The same rules the server enforces on save, plus warnings it does not. */
export function validateChapters(draft: readonly DraftChapter[], totalDurationMs: number | null): ChapterIssue[] {
  const issues: ChapterIssue[] = []
  draft.forEach((chapter, index) => {
    const push = (code: ChapterIssueCode, severity: ChapterIssue['severity']) => issues.push({ key: chapter.key, index, code, severity })
    if (!chapter.title.trim()) push('emptyTitle', 'error')
    if (chapter.title.length > AUDIOBOOK_CHAPTER_LIMITS.maxTitleLength) push('titleTooLong', 'error')
    if (index === AUDIOBOOK_CHAPTER_LIMITS.maxChapters) push('tooMany', 'error')
    if (!Number.isSafeInteger(chapter.startMs) || chapter.startMs < 0) push('invalidStart', 'error')
    if (index === 0 && chapter.startMs !== 0) push('firstNotZero', 'error')
    const previous = draft[index - 1]
    if (previous && chapter.startMs <= previous.startMs) push('notAscending', 'error')
    if (totalDurationMs !== null && chapter.startMs >= totalDurationMs) push('pastEnd', 'error')
    const end = draft[index + 1]?.startMs ?? totalDurationMs
    if (end !== null && end - chapter.startMs > 0 && end - chapter.startMs < SHORT_CHAPTER_MS) push('tooShort', 'warning')
  })
  return issues
}

export function chapterEndMs(draft: readonly DraftChapter[], index: number, totalDurationMs: number | null): number | null {
  return draft[index + 1]?.startMs ?? totalDurationMs
}

export function sortByStart(draft: readonly DraftChapter[]): DraftChapter[] {
  return [...draft].sort((left, right) => left.startMs - right.startMs)
}

export function indexAtTime(draft: readonly DraftChapter[], ms: number): number {
  let found = -1
  for (const [index, chapter] of draft.entries()) {
    if (chapter.startMs <= ms) found = index
    else break
  }
  return found
}

/**
 * A new row after `index`. Without an explicit start it lands halfway to the next boundary, which
 * keeps the list valid where inserting at the same start (as other editors do) would not.
 */
export function insertChapterAfter(
  draft: readonly DraftChapter[],
  index: number,
  title: string,
  totalDurationMs: number | null,
  startMs?: number,
): { draft: DraftChapter[]; key: string } {
  const current = draft[index]
  const nextStart = chapterEndMs(draft, index, totalDurationMs)
  const from = current?.startMs ?? 0
  const at = startMs ?? (nextStart !== null ? Math.round(from + (nextStart - from) / 2) : from + 60_000)
  const row = { key: nextChapterKey(), title, startMs: Math.max(0, Math.round(at)) }
  const nextDraft = [...draft]
  nextDraft.splice(index + 1, 0, row)
  return { draft: sortByStart(nextDraft), key: row.key }
}

/** Splits whichever chapter contains `atMs`; refuses a split on an existing boundary. */
export function splitChapterAt(draft: readonly DraftChapter[], atMs: number, title: string): { draft: DraftChapter[]; key: string } | null {
  const index = indexAtTime(draft, atMs)
  if (index < 0 || draft[index]!.startMs === Math.round(atMs)) return null
  return insertChapterAfter(draft, index, title, null, atMs)
}

export function mergeWithNext(draft: readonly DraftChapter[], index: number): DraftChapter[] {
  if (index < 0 || index >= draft.length - 1) return [...draft]
  return draft.filter((_, position) => position !== index + 1)
}

/** Removing the first chapter hands its audio to the one after it, so the book still starts at 0. */
export function removeChapters(draft: readonly DraftChapter[], keys: ReadonlySet<string>): DraftChapter[] {
  const kept = draft.filter((chapter) => !keys.has(chapter.key))
  if (kept.length === 0) return [...draft]
  if (kept[0]!.startMs !== 0 && draft[0]?.startMs === 0) kept[0] = { ...kept[0]!, startMs: 0 }
  return kept
}

/**
 * Moves the chosen rows by `deltaMs`. A row at 0 stays there: an offset corrects where chapters
 * after a cut intro begin, and the book still starts at its start.
 */
export function shiftChapters(
  draft: readonly DraftChapter[],
  deltaMs: number,
  keys: ReadonlySet<string>,
  totalDurationMs: number | null,
): DraftChapter[] {
  const upper = totalDurationMs !== null ? Math.max(0, totalDurationMs - 1) : Number.MAX_SAFE_INTEGER
  return draft.map((chapter) => {
    if (!keys.has(chapter.key) || chapter.startMs === 0) return chapter
    return { ...chapter, startMs: Math.min(upper, Math.max(0, Math.round(chapter.startMs + deltaMs))) }
  })
}

/** `{n}` in the pattern becomes the running number, zero-padded to `padding` digits. */
export function renumberTitles(
  draft: readonly DraftChapter[],
  keys: ReadonlySet<string>,
  pattern: string,
  start: number,
  padding: number,
): DraftChapter[] {
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    !Number.isInteger(padding) ||
    padding < 0 ||
    padding > 4 ||
    start + keys.size > Number.MAX_SAFE_INTEGER
  ) {
    throw new RangeError('Invalid chapter numbering')
  }
  let counter = start
  return draft.map((chapter) => {
    if (!keys.has(chapter.key)) return chapter
    const number = String(counter).padStart(Math.max(0, padding), '0')
    counter += 1
    return { ...chapter, title: pattern.includes('{n}') ? pattern.replaceAll('{n}', number) : `${pattern} ${number}`.trim() }
  })
}

export class InvalidPatternError extends Error {}

export function replaceInTitles(
  draft: readonly DraftChapter[],
  keys: ReadonlySet<string>,
  find: string,
  replacement: string,
  options: { regex: boolean; caseSensitive: boolean },
): { draft: DraftChapter[]; changed: number } {
  if (!find) return { draft: [...draft], changed: 0 }
  let matcher: RegExp
  try {
    const source = options.regex ? find : find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    matcher = new RegExp(source, options.caseSensitive ? 'g' : 'gi')
  } catch {
    throw new InvalidPatternError(find)
  }
  let changed = 0
  const next = draft.map((chapter) => {
    if (!keys.has(chapter.key)) return chapter
    const title = options.regex ? chapter.title.replace(matcher, replacement) : chapter.title.replace(matcher, () => replacement)
    if (title === chapter.title) return chapter
    changed += 1
    return { ...chapter, title }
  })
  return { draft: next, changed }
}

/**
 * Strips what file names leave in titles: an audio extension, a leading track number written the
 * way file names write it ("01 - ", "Track 03 - ", "003_", "12."), underscores and doubled spaces.
 * A colon is not a file-name separator, so "Part 1: The Door" and "1: Stormblessed" are left alone.
 * A title that would end up empty is kept.
 */
export function cleanTitle(title: string): string {
  const cleaned = title
    .replace(/\.(mp3|m4a|m4b|aac|flac|ogg|opus|wav)$/i, '')
    .replace(/^\s*(?:track\s*)?\d{1,4}\s*(?:[-.)]\s+|_+)/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || title.trim()
}

export function cleanTitles(draft: readonly DraftChapter[], keys: ReadonlySet<string>): { draft: DraftChapter[]; changed: number } {
  let changed = 0
  const next = draft.map((chapter) => {
    if (!keys.has(chapter.key)) return chapter
    const title = cleanTitle(chapter.title)
    if (title === chapter.title) return chapter
    changed += 1
    return { ...chapter, title }
  })
  return { draft: next, changed }
}

/** Folds every chapter shorter than `minMs` into the one before it, keeping the earlier title. */
export function mergeShortChapters(
  draft: readonly DraftChapter[],
  minMs: number,
  totalDurationMs: number | null,
): { draft: DraftChapter[]; merged: number } {
  const kept: DraftChapter[] = []
  draft.forEach((chapter, index) => {
    const end = chapterEndMs(draft, index, totalDurationMs)
    const isShort = end !== null && end - chapter.startMs < minMs
    if (isShort && kept.length > 0) return
    kept.push(chapter)
  })
  return { draft: kept, merged: draft.length - kept.length }
}

/** One chapter per audio file, named after the file; null while any track's start is unknown. */
export function chaptersFromTracks(tracks: readonly { name: string; startMs: number | null }[]): AudiobookChapter[] | null {
  if (tracks.some((track) => track.startMs === null)) return null
  return tracks.map((track) => ({ title: track.name.replace(/\.[^.]+$/, ''), startMs: track.startMs! }))
}

export function sameChapterList(left: readonly AudiobookChapter[], right: readonly AudiobookChapter[]): boolean {
  return (
    left.length === right.length && left.every((chapter, index) => chapter.title === right[index]!.title && chapter.startMs === right[index]!.startMs)
  )
}
