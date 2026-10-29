import type { AudiobookChapter, ChapterLookupNode } from '@bookorbit/types'
import { sortByStart, toDraft, type DraftChapter } from './chapter-edit'

/** What to do with Audible's part headings ("Part One: Above Silence") that group chapters. */
export type PartsMode = 'own' | 'prefix' | 'drop'

export type ApplyMode = 'replace' | 'titles' | 'times'

export type MatchMode = 'time' | 'position'

/** Starts closer than this are taken to be the same boundary. */
export const MATCH_TOLERANCE_MS = 15_000

/**
 * A stretch that moves the last chapter less than this is not offered. Measured at the end of the
 * book, not as a ratio: 0.03% of a ten-hour book is still twelve seconds by the last chapter.
 */
const STRETCH_THRESHOLD_MS = 1_000

/** Fewer matched starts than this are too few to fit a stretch to. */
const STRETCH_FIT_MIN_PAIRS = 3

export interface AlignedRow {
  currentIndex: number | null
  incomingIndex: number | null
  /** Incoming start minus current start, for a matched pair. */
  deltaMs: number | null
}

export interface OffsetSuggestion {
  kind: 'brandIntro' | 'matchStarts'
  offsetMs: number
}

export function hasParts(nodes: readonly ChapterLookupNode[]): boolean {
  return nodes.some((node) => node.children.length > 0)
}

/**
 * A lookup's tree as a flat list. `own` keeps each part heading as a chapter of its own (it usually
 * has a few seconds of announcement), `prefix` folds its name into each child's title, and `drop`
 * leaves only the chapters.
 */
export function flattenLookup(nodes: readonly ChapterLookupNode[], mode: PartsMode, parent: string | null = null): AudiobookChapter[] {
  const chapters: AudiobookChapter[] = []
  for (const node of nodes) {
    const title = parent && mode === 'prefix' ? `${parent} · ${node.title}` : node.title
    if (node.children.length === 0) {
      chapters.push({ title, startMs: node.startMs })
      continue
    }
    if (mode === 'own') chapters.push({ title, startMs: node.startMs })
    chapters.push(...flattenLookup(node.children, mode, mode === 'prefix' ? title : null))
  }
  return chapters
}

/** Shifts then scales: a stretch maps the shifted incoming runtime onto the book's own. */
export function transformTimes(chapters: readonly AudiobookChapter[], offsetMs: number, scale: number): AudiobookChapter[] {
  return chapters.map((chapter) => ({ title: chapter.title, startMs: Math.max(0, Math.round((chapter.startMs + offsetMs) * scale)) }))
}

export interface StretchInput {
  current: readonly AudiobookChapter[]
  /** The incoming chapters before any shift. */
  incoming: readonly AudiobookChapter[]
  offsetMs: number
  totalDurationMs: number | null
  runtimeMs: number | null
  brandIntroMs?: number
  brandOutroMs?: number
}

/**
 * The scale that maps the shifted runtime onto the book's own. Branding is stripped as a pair, so
 * a file that skips Audible's intro is taken to lack its sign-off too.
 */
function runtimeScale({ offsetMs, totalDurationMs, runtimeMs, brandIntroMs = 0, brandOutroMs = 0 }: StretchInput): number | null {
  if (!totalDurationMs || !runtimeMs) return null
  const skipsIntro = brandIntroMs > 0 && offsetMs <= -brandIntroMs / 2
  const contentMs = runtimeMs + offsetMs - (skipsIntro ? brandOutroMs : 0)
  return contentMs > 0 ? totalDurationMs / contentMs : null
}

/**
 * Least squares through 0 over the starts that pair up once roughly stretched. Chapter starts are
 * what the stretch has to land, and a runtime also carries padding the chapters do not: Audible's
 * recordings run a fraction of a second longer at every chapter break.
 */
function fittedScale(current: readonly AudiobookChapter[], shifted: readonly AudiobookChapter[], rough: number): number | null {
  const rows = alignByTime(current, transformTimes(shifted, 0, rough))
  let products = 0
  let squares = 0
  let pairs = 0
  for (const row of rows) {
    if (row.currentIndex === null || row.incomingIndex === null) continue
    const x = shifted[row.incomingIndex]!.startMs
    if (x <= 0) continue
    products += x * current[row.currentIndex]!.startMs
    squares += x * x
    pairs += 1
  }
  return pairs >= STRETCH_FIT_MIN_PAIRS ? products / squares : null
}

/** A stretch worth offering, or null when the incoming times already land close enough. */
export function stretchScale(input: StretchInput): number | null {
  const shifted = transformTimes(input.incoming, input.offsetMs, 1)
  const rough = runtimeScale(input)
  const scale = fittedScale(input.current, shifted, rough ?? 1) ?? rough
  const lastMs = shifted.at(-1)?.startMs ?? 0
  return scale !== null && Math.abs(lastMs * (scale - 1)) > STRETCH_THRESHOLD_MS ? scale : null
}

/**
 * Pairs rows whose starts land within the tolerance, walking both lists in time order, so a source
 * with an extra or a missing chapter does not push every later title onto the wrong row.
 */
export function alignByTime(
  current: readonly AudiobookChapter[],
  incoming: readonly AudiobookChapter[],
  toleranceMs = MATCH_TOLERANCE_MS,
): AlignedRow[] {
  const rows: AlignedRow[] = []
  let i = 0
  let j = 0
  while (i < current.length || j < incoming.length) {
    const here = current[i]
    const there = incoming[j]
    if (here && there && Math.abs(there.startMs - here.startMs) <= toleranceMs) {
      rows.push({ currentIndex: i, incomingIndex: j, deltaMs: there.startMs - here.startMs })
      i += 1
      j += 1
    } else if (here && (!there || here.startMs < there.startMs)) {
      rows.push({ currentIndex: i, incomingIndex: null, deltaMs: null })
      i += 1
    } else {
      rows.push({ currentIndex: null, incomingIndex: j, deltaMs: null })
      j += 1
    }
  }
  return rows
}

/**
 * Pairs rows in order. Skipped incoming rows stand on their own and the rest close up behind them,
 * so leaving out a contents page's front matter lines the remaining titles up with the audio.
 */
export function alignByPosition(
  current: readonly AudiobookChapter[],
  incoming: readonly AudiobookChapter[],
  titlesOnly = false,
  skipped: ReadonlySet<number> = new Set(),
): AlignedRow[] {
  const rows: AlignedRow[] = []
  let next = 0
  incoming.forEach((there, incomingIndex) => {
    const here = skipped.has(incomingIndex) ? undefined : current[next]
    rows.push({
      currentIndex: here ? next : null,
      incomingIndex,
      deltaMs: here && !titlesOnly ? there.startMs - here.startMs : null,
    })
    if (here) next += 1
  })
  for (; next < current.length; next += 1) rows.push({ currentIndex: next, incomingIndex: null, deltaMs: null })
  return rows
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
}

/**
 * Offsets worth offering: the Audible intro when the lookup reports one, and the offset that lines
 * up the first few chapters by position. A file cut differently from Audible's is usually off by
 * one constant, so the median of the early differences is a good first guess.
 */
export function suggestOffsets(
  current: readonly AudiobookChapter[],
  incoming: readonly AudiobookChapter[],
  brandIntroMs: number,
): OffsetSuggestion[] {
  const suggestions: OffsetSuggestion[] = []
  if (brandIntroMs > 0) suggestions.push({ kind: 'brandIntro', offsetMs: -brandIntroMs })
  const differences = current
    .slice(1, 6)
    .map((chapter, index) => (incoming[index + 1] ? chapter.startMs - incoming[index + 1]!.startMs : null))
    .filter((value): value is number => value !== null)
  if (differences.length > 0) {
    const offsetMs = median(differences)
    if (Math.abs(offsetMs) >= 50 && !suggestions.some((suggestion) => Math.abs(suggestion.offsetMs - offsetMs) < 50)) {
      suggestions.push({ kind: 'matchStarts', offsetMs })
    }
  }
  return suggestions
}

/**
 * Writes the chosen incoming rows into the editor. `replace` takes them whole, with the first moved
 * to 0 because a book always starts with a chapter. `titles` and `times` only touch matched pairs.
 */
export function applyIncoming(
  current: readonly DraftChapter[],
  incoming: readonly AudiobookChapter[],
  rows: readonly AlignedRow[],
  mode: ApplyMode,
  included: ReadonlySet<number>,
): { draft: DraftChapter[]; changed: number } {
  if (mode === 'replace') {
    const chosen = incoming.filter((_, index) => included.has(index))
    const ordered = [...chosen].sort((left, right) => left.startMs - right.startMs)
    if (ordered[0]) ordered[0] = { ...ordered[0], startMs: 0 }
    return { draft: toDraft(ordered), changed: ordered.length }
  }

  let changed = 0
  const next = current.map((chapter) => ({ ...chapter }))
  for (const row of rows) {
    if (row.currentIndex === null || row.incomingIndex === null || !included.has(row.incomingIndex)) continue
    const target = next[row.currentIndex]!
    const source = incoming[row.incomingIndex]!
    if (mode === 'titles' && source.title.trim() && target.title !== source.title) {
      target.title = source.title
      changed += 1
    } else if (mode === 'times' && row.currentIndex > 0 && target.startMs !== source.startMs) {
      target.startMs = source.startMs
      changed += 1
    }
  }
  return { draft: mode === 'times' ? sortByStart(next) : next, changed }
}
