import type { BooksPage } from "./book";

export type SeriesSummary = {
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
  name: string;
  bookCount: number;
  readCount: number;
  authors: string[];
  possibleGaps: number[];
};

export type SeriesBooksPage = BooksPage & {
  seriesInfo: SeriesDetail;
};
