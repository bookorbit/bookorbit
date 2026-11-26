import type { BookSeriesMembership, SeriesIndex, SeriesUnit, SeriesUnitCounts } from '@bookorbit/types'

type Translate = (key: string, values?: Record<string, unknown>) => string

/** The label chapters and issues share: a series is named after whichever kind it holds more of. */
export type ChapterGroupUnit = Extract<SeriesUnit, 'chapter' | 'issue'>

/**
 * A book's place in its series as every surface writes it: "Vol. 3", "Ch. 84" or "#12". A position
 * with no unit keeps the bare "#3" the app showed before units existed, untranslated, so a series
 * nobody classified reads exactly as it always did.
 */
export function seriesPositionToken(t: Translate, index: SeriesIndex | number, unit: SeriesUnit | null | undefined): string {
  const value = String(index)
  if (unit === 'volume') return t('series.units.volumeToken', { index: value })
  if (unit === 'chapter') return t('series.units.chapterToken', { index: value })
  if (unit === 'issue') return t('series.units.issueToken', { index: value })
  return `#${value}`
}

/** "Dune Vol. 3" for one-line labels, or the bare name when the book has no position. */
export function seriesNameWithPosition(
  t: Translate,
  name: string,
  index: SeriesIndex | null | undefined,
  unit: SeriesUnit | null | undefined,
): string {
  return index == null ? name : `${name} ${seriesPositionToken(t, index, unit)}`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Whether a title already carries its own position, as "Harbor of Lanterns, Vol. 3" does, so the
 * caller can drop the token instead of printing it twice. "#1" does not match inside "#12".
 */
export function titleContainsPositionToken(title: string, token: string): boolean {
  if (!token) return false
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(token)}(?!\\p{N}|[.,]\\p{N})`, 'iu').test(title)
}

/**
 * "Ch. 93 · Embers" for a unit-tagged position, dropping the token when the title already says it.
 * A position with no unit keeps today's "#93 · Embers" untouched.
 */
export function seriesPositionWithTitle(
  t: Translate,
  index: SeriesIndex | null | undefined,
  unit: SeriesUnit | null | undefined,
  title: string,
): string {
  if (index == null || index === '') return title
  const token = seriesPositionToken(t, index, unit)
  if (unit && titleContainsPositionToken(title, token)) return title
  return `${token} · ${title}`
}

/**
 * The unit behind a book's top-level `seriesIndex`, for responses that carry it only on the
 * memberships: the membership of `seriesId`, or the first one by display order.
 */
export function primarySeriesUnit(book: { seriesId?: number | null; seriesMemberships?: readonly BookSeriesMembership[] }): SeriesUnit | null {
  const memberships = book.seriesMemberships ?? []
  const primary =
    memberships.find((membership) => book.seriesId != null && membership.seriesId === book.seriesId) ??
    [...memberships].sort((a, b) => a.displayOrder - b.displayOrder)[0]
  return primary?.unit ?? null
}

/** Chapters and issues together, which is what the Chapters tab and the chapter line count. */
export function chapterUnitCount(counts: SeriesUnitCounts | null | undefined): number {
  return counts ? counts.chapter + counts.issue : 0
}

export function seriesHasChapters(counts: SeriesUnitCounts | null | undefined): boolean {
  return chapterUnitCount(counts) > 0
}

/**
 * A series holding chapters or issues and no volumes. Its ladder, counts and gaps from the server
 * already run on the chapter line, so nothing should add the chapters a second time.
 */
export function seriesLadderIsChapters(counts: SeriesUnitCounts | null | undefined): boolean {
  return counts != null && counts.volume === 0 && chapterUnitCount(counts) > 0
}

/** Volumes and chapters side by side: the only case the series page offers its kind tabs. */
export function seriesHasMixedUnits(counts: SeriesUnitCounts | null | undefined): boolean {
  return counts != null && counts.volume > 0 && chapterUnitCount(counts) > 0
}

export function chapterGroupUnit(counts: SeriesUnitCounts | null | undefined): ChapterGroupUnit {
  return counts != null && counts.issue > counts.chapter ? 'issue' : 'chapter'
}

/** "20 chapters" or "12 issues". */
export function chapterCountLabel(t: Translate, counts: SeriesUnitCounts | null | undefined): string {
  const count = chapterUnitCount(counts)
  return chapterGroupUnit(counts) === 'issue' ? t('series.units.issueCount', { count }) : t('series.units.chapterCount', { count })
}

/**
 * "10 volumes · 20 chapters" for a series holding both kinds and "20 chapters" for one holding
 * only chapters. Null for a series of volumes alone, which keeps the caller's own wording.
 */
export function seriesUnitCountsLabel(t: Translate, counts: SeriesUnitCounts | null | undefined, volumes = counts?.volume ?? 0): string | null {
  if (!seriesHasChapters(counts)) return null
  const chapters = chapterUnitCount(counts)
  const issues = chapterGroupUnit(counts) === 'issue'
  if (volumes <= 0) return chapterCountLabel(t, counts)
  return issues ? t('series.units.volumesAndIssues', { volumes, issues: chapters }) : t('series.units.volumesAndChapters', { volumes, chapters })
}

/**
 * Volume numbers as a series names them: "Vol. 11" once chapters share the series, so the two
 * number lines cannot be confused, and the plain "#11" otherwise.
 */
export function volumeNumberToken(t: Translate, index: number | SeriesIndex, counts: SeriesUnitCounts | null | undefined): string {
  return seriesPositionToken(t, index, seriesHasChapters(counts) ? 'volume' : null)
}

export function chapterNumberToken(t: Translate, index: number | SeriesIndex, counts: SeriesUnitCounts | null | undefined): string {
  return seriesPositionToken(t, index, chapterGroupUnit(counts))
}

/** A rung of the ladder: "#3" for an issue-only series, "Vol. 3" or "#3" otherwise. */
export function ladderNumberToken(t: Translate, index: number | SeriesIndex, counts: SeriesUnitCounts | null | undefined): string {
  return seriesLadderIsChapters(counts) ? chapterNumberToken(t, index, counts) : volumeNumberToken(t, index, counts)
}

/**
 * Missing numbers in the series' own words: volume gaps first, then chapter or issue gaps. A series
 * with no volumes gets its chapter gaps in both lists, so they are named once.
 */
export function seriesGapTokens(
  t: Translate,
  volumeGaps: readonly number[],
  chapterGaps: readonly number[],
  counts: SeriesUnitCounts | null | undefined,
): string[] {
  const volumes = seriesLadderIsChapters(counts) ? [] : volumeGaps.map((gap) => volumeNumberToken(t, gap, counts))
  return [...volumes, ...chapterGaps.map((gap) => chapterNumberToken(t, gap, counts))]
}

/** A capped gap list with "+3" for the numbers the server left out of the preview. */
export function gapListPreview(t: Translate, tokens: readonly string[], total: number): string {
  const shown = tokens.join(', ')
  const rest = total - tokens.length
  return rest > 0 ? t('series.gaps.previewMore', { shown, count: rest }) : shown
}
