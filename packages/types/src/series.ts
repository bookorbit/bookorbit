import type { BooksPage } from "./book";
import type { SeriesIndex } from "./series-index";

export type SeriesSummary = {
  id: number;
  name: string;
  bookCount: number;
  readCount: number;
  authors: string[];
  coverBookIds: number[];
  lastAddedAt: string | null;
};

export type SeriesPage = {
  items: SeriesSummary[];
  total: number;
  page: number;
  size: number;
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
