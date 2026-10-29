import { CHAPTER_PAUSE_LIMITS, type ChapterPause, type ChapterPauseWindow } from '@bookorbit/types'
import type { DraftChapter } from './chapter-edit'

/** Where in a pause a snapped chapter starts. */
export type SnapPlacement = 'end' | 'middle'

/**
 * How long before speech resumes a snapped start sits. Measured on a commercial release: its own
 * markers sit 0.25 to 0.55 s before the narrator speaks, so a jump never clips the first syllable.
 */
export const SNAP_LEAD_MS = 300

/** Two chapters closer than this are a mistake, never a choice. */
const MIN_CHAPTER_GAP_MS = 1_000

/**
 * A pause's length counts for more than its distance when choosing between candidates: a chapter
 * break is usually the longest silence around, and a sentence pause nearer the guess is not it.
 */
const DISTANCE_WEIGHT = 0.25

/** Extra audio either side of the search radius, so a long pause at its edge is heard whole. */
const WINDOW_MARGIN_MS = 2_000
/** Progressive snapping moves its guesses within a batch, so it listens a little wider. */
const PROGRESSIVE_MARGIN_MS = 4_000

const BATCH_SIZE = 25
const PROGRESSIVE_BATCH_SIZE = 10

export type AnalyzePauses = (points: number[], windowMs: number, signal?: AbortSignal) => Promise<ChapterPauseWindow[]>

export interface SnapOptions {
  /** How far either side of a start to look. */
  radiusMs: number
  placement: SnapPlacement
  /** Carry each correction into the guess for the next start, for timings that drift. */
  progressive: boolean
  totalDurationMs: number | null
}

export interface SnapOutcome {
  draft: DraftChapter[]
  /** Starts that landed on a pause. */
  snapped: number
  /** Starts that end up somewhere else, including ones only carried along by a progressive snap. */
  moved: number
  notFound: number
  /** Starts left alone because the pause would put them out of order. */
  blocked: number
  /** Starts whose audio could not be decoded. */
  failed: number
  meanShiftMs: number
  maxShiftMs: number
}

export interface SnapProgress {
  done: number
  total: number
}

export function pauseAnchor(pause: ChapterPause, placement: SnapPlacement): number {
  const middle = Math.round((pause.startMs + pause.endMs) / 2)
  return placement === 'middle' ? middle : Math.max(middle, pause.endMs - SNAP_LEAD_MS)
}

/** The pause a boundary near `pointMs` most likely sits in, and where in it the start goes. */
export function pickPause(pointMs: number, pauses: readonly ChapterPause[], radiusMs: number, placement: SnapPlacement): number | null {
  let best: number | null = null
  let bestScore = Number.NEGATIVE_INFINITY
  for (const pause of pauses) {
    const atMs = pauseAnchor(pause, placement)
    const distance = Math.abs(atMs - pointMs)
    if (distance > radiusMs) continue
    const score = pause.endMs - pause.startMs - DISTANCE_WEIGHT * distance
    if (score > bestScore) {
      best = atMs
      bestScore = score
    }
  }
  return best
}

export function snapWindowMs(radiusMs: number, progressive: boolean): number {
  const width = 2 * (radiusMs + (progressive ? PROGRESSIVE_MARGIN_MS : WINDOW_MARGIN_MS))
  return Math.min(CHAPTER_PAUSE_LIMITS.maxWindowMs, Math.max(CHAPTER_PAUSE_LIMITS.minWindowMs, width))
}

/** Whether a window heard the whole search range around a guess. Its edges only fall short at the ends of the book. */
function covers(window: ChapterPauseWindow, guessMs: number, radiusMs: number, windowMs: number): boolean {
  const clippedStart = window.fromMs <= 0
  const clippedEnd = window.toMs - window.fromMs < windowMs - 1 && !clippedStart
  return (clippedStart || guessMs - radiusMs >= window.fromMs) && (clippedEnd || guessMs + radiusMs <= window.toMs)
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new DOMException('Snapping was cancelled', 'AbortError')
}

/**
 * Moves the chosen starts onto nearby pauses, asking the server in batches. The first chapter
 * stays at 0, and a pause that would put a start out of order is ignored, so the result is always
 * a valid list. A progressive snap carries each correction forward: when a file's timings drift by
 * a couple of seconds per chapter, the guess for each start already includes the drift so far.
 */
export async function snapToPauses(
  rows: readonly DraftChapter[],
  keys: ReadonlySet<string>,
  options: SnapOptions,
  analyze: AnalyzePauses,
  onProgress?: (progress: SnapProgress) => void,
  signal?: AbortSignal,
): Promise<SnapOutcome> {
  const targets = rows.flatMap((row, index) => (index > 0 && keys.has(row.key) ? [index] : []))
  const starts = rows.map((row) => row.startMs)
  const total = options.totalDurationMs ?? Number.POSITIVE_INFINITY
  const windowMs = snapWindowMs(options.radiusMs, options.progressive)
  const batchSize = Math.min(
    options.progressive ? PROGRESSIVE_BATCH_SIZE : BATCH_SIZE,
    CHAPTER_PAUSE_LIMITS.maxPoints,
    Math.max(1, Math.floor(CHAPTER_PAUSE_LIMITS.maxAudioMs / windowMs)),
  )
  const counts = { snapped: 0, notFound: 0, blocked: 0, failed: 0 }
  let carry = 0

  for (let offset = 0; offset < targets.length; offset += batchSize) {
    throwIfAborted(signal)
    const batch = targets.slice(offset, offset + batchSize)
    const points = batch.map((index) => Math.max(0, Math.round(Math.min(rows[index]!.startMs + carry, total))))
    const windows = await analyze(points, windowMs, signal)

    for (const [position, index] of batch.entries()) {
      const original = rows[index]!.startMs
      const guess = options.progressive ? original + carry : original
      const fallback = guess < total ? guess : original
      const previous = starts[index - 1]!
      const next = rows[index + 1]
      // An unresolved neighbour must remain a safe fallback if its analysis fails.
      const ceiling = next ? next.startMs - MIN_CHAPTER_GAP_MS : total - MIN_CHAPTER_GAP_MS
      let window = windows[position]
      // The batch was heard around the guesses it started with; a correction since may have moved
      // this guess out of its window, so listen again around where it now is.
      if (window && !window.failed && !covers(window, guess, options.radiusMs, windowMs)) {
        throwIfAborted(signal)
        window = (await analyze([Math.max(0, Math.round(Math.min(guess, total)))], windowMs, signal))[0]
      }

      let landed: number | null = null
      if (!window || window.failed) counts.failed += 1
      else {
        const pick = pickPause(guess, window.pauses, options.radiusMs, options.placement)
        if (pick === null) counts.notFound += 1
        else if (pick <= previous + MIN_CHAPTER_GAP_MS || pick >= ceiling) counts.blocked += 1
        else landed = pick
      }

      if (landed !== null) {
        counts.snapped += 1
        starts[index] = landed
        if (options.progressive) carry = landed - original
      } else {
        starts[index] = fallback > previous + MIN_CHAPTER_GAP_MS && fallback < ceiling + MIN_CHAPTER_GAP_MS ? fallback : original
      }
    }
    onProgress?.({ done: Math.min(offset + batch.length, targets.length), total: targets.length })
  }

  const shifts = rows.flatMap((row, index) => (starts[index] !== row.startMs ? [Math.abs(starts[index]! - row.startMs)] : []))
  return {
    draft: rows.map((row, index) => (starts[index] === row.startMs ? row : { ...row, startMs: starts[index]! })),
    ...counts,
    moved: shifts.length,
    meanShiftMs: shifts.length ? Math.round(shifts.reduce((sum, shift) => sum + shift, 0) / shifts.length) : 0,
    maxShiftMs: shifts.length ? Math.max(...shifts) : 0,
  }
}

export interface PauseFit {
  offsetMs: number
  /** Starts that land in a pause at this offset, out of those that could be heard. */
  hits: number
  total: number
}

/** How many incoming starts the pause fit listens around. The first few chapters carry little drift. */
export const PAUSE_FIT_POINTS = 12
export const PAUSE_FIT_RANGE_MS = 30_000
const PAUSE_FIT_STEP_MS = 50
/** A start just after a pause still counts: some releases mark the first word, not the silence. */
const PAUSE_FIT_SLACK_MS = 300

/**
 * The single offset that lands the most incoming starts in a pause of the book's own audio.
 * `windows[i]` must be centred on `starts[i]` and cover the whole search range. Among offsets that
 * land as many, the one closest to where a snap would put each start wins, then the smallest.
 */
export function fitOffsetToPauses(starts: readonly number[], windows: readonly ChapterPauseWindow[], rangeMs = PAUSE_FIT_RANGE_MS): PauseFit | null {
  const heard = starts.flatMap((start, index) => {
    const window = windows[index]
    return window && !window.failed ? [{ start, pauses: window.pauses }] : []
  })
  if (heard.length === 0) return null

  let best: { offsetMs: number; hits: number; cost: number } | null = null
  for (let offsetMs = -rangeMs; offsetMs <= rangeMs; offsetMs += PAUSE_FIT_STEP_MS) {
    let hits = 0
    let cost = 0
    for (const { start, pauses } of heard) {
      const at = start + offsetMs
      const landed = pauses.filter((pause) => at >= pause.startMs && at <= pause.endMs + PAUSE_FIT_SLACK_MS)
      if (landed.length === 0) continue
      hits += 1
      cost += Math.min(...landed.map((pause) => Math.abs(at - pauseAnchor(pause, 'end'))))
    }
    const better =
      !best ||
      hits > best.hits ||
      (hits === best.hits && cost < best.cost) ||
      (hits === best.hits && cost === best.cost && Math.abs(offsetMs) < Math.abs(best.offsetMs))
    if (better) best = { offsetMs, hits, cost }
  }
  return best && best.hits > 0 ? { offsetMs: best.offsetMs, hits: best.hits, total: heard.length } : null
}
