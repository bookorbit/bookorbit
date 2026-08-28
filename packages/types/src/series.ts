import type { BooksPage } from "./book";
import type { SeriesIndex } from "./series-index";

export type SeriesVolumeStatus = "read" | "reading" | "unread" | "missing";

/**
 * One position on a series' volume ladder. A `missing` slot is a number the series should
 * have and the library does not; every other slot has a book behind it. Slots with no usable
 * index sit at the end with `index: null`.
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
  volumes: SeriesVolumeSlot[];
  volumesTruncated: boolean;
  /** Missing numbers, capped at {@link SERIES_GAP_PREVIEW_LIMIT}. */
  gaps: number[];
  gapCount: number;
  /** The volume to open next: the one in progress, else the first unread. */
  nextBookId: number | null;
  nextIndex: SeriesIndex | null;
  nextTitle: string | null;
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
  readCount: number;
  authors: string[];
  possibleGaps: number[];
  /** Total books a metadata provider reports for the series, or null when no provider has told us. */
  expectedBookCount: number | null;
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
};

export type SeriesNextBookResponse = {
  next: SeriesNextBook | null;
};
