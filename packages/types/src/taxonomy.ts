/**
 * Genres and tags share one browse surface: an index of every name with books the viewer can see,
 * and a page per name listing those books. Both are read-only views over `book_genres` and
 * `book_tags`; renaming, merging and deleting stay with the Entity Manager.
 */
export const TAXONOMY_KINDS = ["genre", "tag"] as const;
export type TaxonomyKind = (typeof TAXONOMY_KINDS)[number];

export const TAXONOMY_INDEX_SORTS = ["name", "bookCount", "readProgress", "libraryCount", "lastAddedAt"] as const;
export type TaxonomyIndexSort = (typeof TAXONOMY_INDEX_SORTS)[number];

/** One row of the index, counted over the books the viewer can see in the chosen libraries. */
export type TaxonomySummary = {
  id: number;
  name: string;
  bookCount: number;
  readCount: number;
  readingCount: number;
  libraryCount: number;
  lastAddedAt: string | null;
  /** Up to three recently added books with a cover, newest first. */
  coverBookIds: number[];
};

export type TaxonomyPage = {
  items: TaxonomySummary[];
  total: number;
  page: number;
  size: number;
  /** How many genres and tags have visible books in the chosen libraries, ignoring the search. */
  totals: Record<TaxonomyKind, number>;
};

export type TaxonomyLibraryCount = {
  id: number;
  name: string;
  bookCount: number;
};

export type TaxonomyDetail = {
  id: number;
  kind: TaxonomyKind;
  name: string;
  /** Visible books across every library the viewer can open. */
  bookCount: number;
  /** The libraries holding those books, most books first. */
  libraries: TaxonomyLibraryCount[];
};

export type TaxonomyName = {
  id: number;
  name: string;
  bookCount: number;
};

export type TaxonomySimilarResponse = {
  items: TaxonomyName[];
};

export function taxonomyRouteSegment(kind: TaxonomyKind): "genres" | "tags" {
  return kind === "genre" ? "genres" : "tags";
}
