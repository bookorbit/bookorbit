import type { SeriesSummary, SeriesUnitCounts, SeriesVolumeSlot } from '@bookorbit/types'
import { chapterUnitCount, seriesLadderIsChapters } from './series-unit-label'

/**
 * What a row actually shows, derived once so the grid card and the list row can never
 * disagree about a series.
 *
 * The volume counts are the server's logical-volume counts rather than `bookCount`, because a
 * library holding the same volume twice - one ebook, one audiobook - owns two books and one
 * volume, and "3 of 7" only reads correctly when it counts volumes. They are not counted from
 * `volumes`, which is capped and would stop a long series at the cap. Chapters and issues are
 * counted beside the volumes, never on the ladder, so "Vol. 1" and "Ch. 1" stay two books.
 */
export type SeriesRowFacts = {
  ownedVolumes: number
  readVolumes: number
  readingVolumes: number
  /** Chapters and issues, which sit off the volume ladder on their own number line. */
  chapters: number
  readChapters: number
  /** Volumes and chapters together: what the progress figures and the finished state count. */
  ownedTotal: number
  readTotal: number
  percentRead: number
  isComplete: boolean
  isStarted: boolean
  isSingleVolume: boolean
  hasGaps: boolean
  /** Missing volume numbers; zero when the ladder runs on chapters, whose gaps are `chapterGapCount`. */
  volumeGapCount: number
  /** True when the ladder is a real ladder of numbered rungs rather than a flat run of books. */
  isNumbered: boolean
}

export type SeriesUnitProgressInput = {
  ownedVolumeCount: number
  readVolumeCount: number
  unitCounts?: SeriesUnitCounts | null
  chapterReadCount?: number
}

export type SeriesUnitProgress = {
  ownedVolumes: number
  readVolumes: number
  chapters: number
  readChapters: number
  ownedTotal: number
  readTotal: number
  /** The series has chapters or issues and no volumes, so its ladder runs on them. */
  chapterLadder: boolean
}

/**
 * Volumes and chapters as two counts and one total. With no volumes the server's ladder counts are
 * the chapters themselves, kept that way for clients that predate units, so they are read as
 * chapters here rather than added to them.
 */
export function seriesUnitProgress(input: SeriesUnitProgressInput): SeriesUnitProgress {
  const chapterLadder = seriesLadderIsChapters(input.unitCounts)
  const ownedVolumes = chapterLadder ? 0 : input.ownedVolumeCount
  const readVolumes = chapterLadder ? 0 : input.readVolumeCount
  const chapters = chapterLadder ? input.ownedVolumeCount : chapterUnitCount(input.unitCounts)
  const readChapters = chapterLadder ? input.readVolumeCount : chapters > 0 ? Math.min(input.chapterReadCount ?? 0, chapters) : 0
  return {
    ownedVolumes,
    readVolumes,
    chapters,
    readChapters,
    ownedTotal: ownedVolumes + chapters,
    readTotal: readVolumes + readChapters,
    chapterLadder,
  }
}

export function seriesRowFacts(series: SeriesSummary): SeriesRowFacts {
  const reading = series.readingVolumeCount
  const progress = seriesUnitProgress(series)
  const owned = progress.ownedVolumes
  const read = progress.readVolumes
  const { chapters, readChapters, ownedTotal, readTotal, chapterLadder } = progress

  return {
    ownedVolumes: owned,
    readVolumes: read,
    readingVolumes: reading,
    chapters,
    readChapters,
    ownedTotal,
    readTotal,
    percentRead: ownedTotal > 0 ? Math.round((readTotal / ownedTotal) * 100) : 0,
    isComplete: ownedTotal > 0 && readTotal === ownedTotal,
    isStarted: readTotal > 0 || reading > 0,
    isSingleVolume: owned === 1 && chapters === 0,
    hasGaps: series.gapCount > 0 || (series.chapterGapCount ?? 0) > 0,
    volumeGapCount: chapterLadder ? 0 : series.gapCount,
    isNumbered: series.volumes.some((slot) => slot.index !== null),
  }
}

/** Volumes that have a cover to show, in series order. Missing rungs hold no book. */
export function seriesCoverSlots(series: SeriesSummary): SeriesVolumeSlot[] {
  const present = series.volumes.filter((slot) => slot.bookId !== null)
  if (present.length > 0) return present
  // A ladder we could not build still has covers worth showing.
  return series.coverBookIds.map((bookId) => ({ index: null, bookId, title: null, status: 'unread' as const }))
}

export function seriesAuthorLine(series: SeriesSummary): string | null {
  const authors = series.authors
  if (authors.length === 0) return null
  if (authors.length <= 2) return authors.join(', ')
  return `${authors[0]}, ${authors[1]}`
}

/** Authors beyond the two the line names, for a "+2" suffix the caller can translate. */
export function seriesExtraAuthorCount(series: SeriesSummary): number {
  return Math.max(0, series.authors.length - 2)
}

/**
 * `lastAddedAt` arrives as a Postgres timestamp - `2026-08-15 04:35:41.046562+00` - which is not
 * ISO 8601 on two counts: a space instead of `T`, and a two-digit UTC offset where ISO wants
 * `+00:00`. `new Date()` rejects it outright in some engines and silently mis-parses in others,
 * so it is normalised here rather than at each call site.
 */
export function parseAddedAt(value: string | null): Date | null {
  if (!value) return null
  const normalized = value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
