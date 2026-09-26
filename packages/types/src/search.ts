import type { AuthorSummary } from "./author";
import type { BookCard } from "./book";
import type { SeriesSummary } from "./series";

export type GlobalSearchMatchField = "title" | "author" | "series" | "narrator" | "name";

export type GlobalSearchHit<T> = {
  item: T;
  matchedField: GlobalSearchMatchField;
  matchedText: string | null;
};

export type GlobalSearchSection<T> = {
  items: GlobalSearchHit<T>[];
  total: number;
};

export type GlobalSearchResponse = {
  query: string;
  books: GlobalSearchSection<BookCard>;
  authors: GlobalSearchSection<AuthorSummary>;
  series: GlobalSearchSection<SeriesSummary>;
};
