import type { BooksPage } from "./book";
import type { SeriesIndex } from "./series-index";
import type { SeriesUnit, SeriesUnitCounts } from "./series-unit";

export type SeriesVolumeStatus = "read" | "reading" | "unread" | "missing";

/**
 * One position on a series' volume ladder. A `missing` slot is a number the series should
 * have and the library does not; every other slot has a book behind it. Slots with no usable
 * index sit at the end with `index: null`. The ladder holds volumes and unclassified books only;
 * chapters and issues are counted in `SeriesSummary.unitCounts`.
 */
export type SeriesVolumeSlot = {
  index: number | null;
  bookId: number | null;
  title: string | null;
  status: SeriesVolumeStatus;
};

/**
 * Upper bound on the ladder a list row carries. A longer series still reports its true counts;
 * only the per-slot detail is cut, flagged by `volumesTruncated`.
 */
export const SERIES_VOLUME_SLOT_LIMIT = 60;

/** Missing numbers named in a list row before the rest collapse into `gapCount`. */
export const SERIES_GAP_PREVIEW_LIMIT = 8;

export type SeriesSummary = {
  id: number;
  name: string;
  bookCount: number;
  /** Books counted once per work: linked editions count as one. Absent from servers without `book-editions`. */
  workCount?: number;
  readCount: number;
  authors: string[];
  coverBookIds: number[];
  lastAddedAt: string | null;
  /** Books the user has in progress. */
  readingCount: number;
  /** Libraries the series spans, in name order. Usually one. */
  libraryNames: string[];
  /** Total a metadata provider reports for the series, or null when no provider has said. */
  expectedBookCount: number | null;
  /**
   * Logical volumes owned across the whole series, collapsing book records that share a
   * whole-numbered position. Unlike `volumes`, never capped; falls back to `bookCount` when the
   * members could not all be read.
   */
  ownedVolumeCount: number;
  /** Owned logical volumes whose furthest status is read. */
  readVolumeCount: number;
  /** Owned logical volumes whose furthest status is reading. */
  readingVolumeCount: number;
  volumes: SeriesVolumeSlot[];
  volumesTruncated: boolean;
  /** Missing numbers, capped at {@link SERIES_GAP_PREVIEW_LIMIT}. */
  gaps: number[];
  gapCount: number;
  /** The volume to open next: the one in progress, else the first unread. */
  nextBookId: number | null;
  nextIndex: SeriesIndex | null;
  nextTitle: string | null;
  /** The unit of the next book, so a client can say "Ch. 93". Absent from servers without `series-units`. */
  nextUnit?: SeriesUnit | null;
  /** Books per unit. Absent from servers without `series-units`. */
  unitCounts?: SeriesUnitCounts;
  /** Chapters and issues the user has read. Absent from servers without `series-units`. */
  chapterReadCount?: number;
  /**
   * Chapter or issue numbers missing between the lowest and highest owned, capped at
   * {@link SERIES_GAP_PREVIEW_LIMIT}. `gaps` covers volumes only. Absent from servers without `series-units`.
   */
  chapterGaps?: number[];
  chapterGapCount?: number;
};

/** Counts for the whole result set, ignoring the active completion filter. */
export type SeriesFacets = {
  all: number;
  notStarted: number;
  inProgress: number;
  complete: number;
  hasGaps: number;
};

export type SeriesPage = {
  items: SeriesSummary[];
  total: number;
  page: number;
  size: number;
  facets: SeriesFacets;
};

export type SeriesDetail = {
  id: number;
  name: string;
  bookCount: number;
  /** Books counted once per work: linked editions count as one. Absent from servers without `book-editions`. */
  workCount?: number;
  readCount: number;
  /** Logical volumes owned, collapsing book records that share a whole-numbered series position. */
  ownedVolumeCount?: number;
  /** Owned logical volumes whose furthest status is read. */
  readVolumeCount?: number;
  authors: string[];
  /** Missing volume numbers. Chapters and issues are in `chapterGaps` on servers with `series-units`. */
  possibleGaps: number[];
  /** Total books a metadata provider reports for the series, or null when no provider has told us. */
  expectedBookCount: number | null;
  /** Books per unit in the listed libraries. Absent from servers without `series-units`. */
  unitCounts?: SeriesUnitCounts;
  /** Chapter or issue numbers missing between the lowest and highest owned. Absent from servers without `series-units`. */
  chapterGaps?: number[];
  /** Chapter and issue books the user has read. Absent from servers without `series-units`. */
  chapterReadCount?: number;
};

export type SeriesBooksPage = BooksPage & {
  seriesInfo: SeriesDetail;
};

/** A series book the reader can open next, already resolved down to the file it should open. */
export type SeriesNextBook = {
  bookId: number;
  fileId: number;
  format: string;
  title: string | null;
  seriesIndex: SeriesIndex | null;
  /** Absent from servers without `series-units`. */
  seriesUnit?: SeriesUnit | null;
};

export type SeriesNextBookResponse = {
  next: SeriesNextBook | null;
};
