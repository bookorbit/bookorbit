export const CORE_BOOK_FILE_WRITE_FIELDS = [
  "title",
  "subtitle",
  "description",
  "publisher",
  "publishedDate",
  "publishedYear",
  "language",
  "pageCount",
  "seriesName",
  "seriesIndex",
  "isbn10",
  "isbn13",
  "rating",
  "authors",
  "genres",
  "tags",
] as const;

export const COMMON_PROVIDER_BOOK_FILE_WRITE_FIELDS = [
  "googleBooksId",
  "goodreadsId",
  "amazonId",
  "hardcoverId",
  "hardcoverEditionId",
  "openLibraryId",
  "ranobedbId",
  "koboId",
  "lubimyczytacId",
  "aladinId",
  "mangabakaId",
  "mangabakaSeriesId",
] as const;

export const COMIC_BOOK_FILE_WRITE_FIELDS = [
  "comicvineId",
  "comicIssueNumber",
  "comicVolumeName",
  "comicPencillers",
  "comicInkers",
  "comicColorists",
  "comicLetterers",
  "comicCoverArtists",
  "comicCharacters",
  "comicTeams",
  "comicLocations",
  "comicStoryArcs",
] as const;

export const BOOK_FILE_WRITE_FIELDS = [
  ...CORE_BOOK_FILE_WRITE_FIELDS,
  ...COMMON_PROVIDER_BOOK_FILE_WRITE_FIELDS,
  ...COMIC_BOOK_FILE_WRITE_FIELDS,
  "itunesId",
  "audibleId",
  "librofmId",
  "narrators",
  "coverBytes",
] as const;

export type BookFileWriteField = (typeof BOOK_FILE_WRITE_FIELDS)[number];

export const BOOK_FILE_WRITE_FIELD_LABELS = {
  title: "Title",
  subtitle: "Subtitle",
  description: "Description",
  publisher: "Publisher",
  publishedDate: "Published date",
  publishedYear: "Published year",
  language: "Language",
  pageCount: "Page count",
  seriesName: "Series",
  seriesIndex: "Series index",
  isbn10: "ISBN-10",
  isbn13: "ISBN-13",
  rating: "Rating",
  authors: "Authors",
  genres: "Genres",
  tags: "Tags",
  googleBooksId: "Google Books ID",
  goodreadsId: "Goodreads ID",
  amazonId: "Amazon ID",
  hardcoverId: "Hardcover ID",
  hardcoverEditionId: "Hardcover edition ID",
  openLibraryId: "Open Library ID",
  ranobedbId: "RanobeDB ID",
  koboId: "Kobo ID",
  lubimyczytacId: "LubimyCzytac ID",
  aladinId: "Aladin ID",
  mangabakaId: "MangaBaka ID",
  mangabakaSeriesId: "MangaBaka Series ID",
  comicvineId: "ComicVine ID",
  comicIssueNumber: "Issue number",
  comicVolumeName: "Volume",
  comicPencillers: "Pencillers",
  comicInkers: "Inkers",
  comicColorists: "Colorists",
  comicLetterers: "Letterers",
  comicCoverArtists: "Cover artists",
  comicCharacters: "Characters",
  comicTeams: "Teams",
  comicLocations: "Locations",
  comicStoryArcs: "Story arcs",
  itunesId: "iTunes ID",
  audibleId: "Audible ID",
  librofmId: "Libro.fm ISBN",
  narrators: "Narrators",
  coverBytes: "Cover",
} as const satisfies Record<BookFileWriteField, string>;

export const EPUB_BOOK_FILE_WRITE_FIELDS = [
  ...CORE_BOOK_FILE_WRITE_FIELDS,
  ...COMMON_PROVIDER_BOOK_FILE_WRITE_FIELDS,
  "itunesId",
  "coverBytes",
] as const satisfies readonly BookFileWriteField[];

// FB2 keeps managed metadata in <description>: standard slots cover the core
// fields, and <custom-info info-type="bookorbit:*"> carries the rest.
export const FB2_BOOK_FILE_WRITE_FIELDS = [
  ...CORE_BOOK_FILE_WRITE_FIELDS,
  ...COMMON_PROVIDER_BOOK_FILE_WRITE_FIELDS,
  "itunesId",
  "coverBytes",
] as const satisfies readonly BookFileWriteField[];

export const PDF_BOOK_FILE_WRITE_FIELDS = [
  ...CORE_BOOK_FILE_WRITE_FIELDS,
  ...COMMON_PROVIDER_BOOK_FILE_WRITE_FIELDS,
  "itunesId",
] as const satisfies readonly BookFileWriteField[];

export const CBX_BOOK_FILE_WRITE_FIELDS = [
  ...CORE_BOOK_FILE_WRITE_FIELDS,
  ...COMMON_PROVIDER_BOOK_FILE_WRITE_FIELDS,
  ...COMIC_BOOK_FILE_WRITE_FIELDS,
] as const satisfies readonly BookFileWriteField[];

// MOBI EXTH records are keyed by number and have no extensible string-keyed
// namespace, so fields without a standard EXTH slot (series, rating, page count,
// subtitle, provider IDs, comic fields, narrators) cannot be represented at all.
export const MOBI_BOOK_FILE_WRITE_FIELDS = [
  "title",
  "description",
  "publisher",
  "publishedDate",
  "language",
  "isbn10",
  "isbn13",
  "authors",
  "genres",
  "tags",
  "coverBytes",
] as const satisfies readonly BookFileWriteField[];

export const AUDIO_BOOK_FILE_WRITE_FIELDS = [
  "title",
  "subtitle",
  "authors",
  "narrators",
  "publishedDate",
  "publishedYear",
  "publisher",
  "description",
  "genres",
  "language",
  "seriesName",
  "seriesIndex",
  "audibleId",
  "librofmId",
  "coverBytes",
] as const satisfies readonly BookFileWriteField[];

export const BOOK_FILE_WRITE_FORMAT_FIELDS = {
  epub: EPUB_BOOK_FILE_WRITE_FIELDS,
  fb2: FB2_BOOK_FILE_WRITE_FIELDS,
  pdf: PDF_BOOK_FILE_WRITE_FIELDS,
  cbz: CBX_BOOK_FILE_WRITE_FIELDS,
  cb7: CBX_BOOK_FILE_WRITE_FIELDS,
  mobi: MOBI_BOOK_FILE_WRITE_FIELDS,
  azw3: MOBI_BOOK_FILE_WRITE_FIELDS,
  azw: MOBI_BOOK_FILE_WRITE_FIELDS,
  m4b: AUDIO_BOOK_FILE_WRITE_FIELDS,
  m4a: AUDIO_BOOK_FILE_WRITE_FIELDS,
  mp3: AUDIO_BOOK_FILE_WRITE_FIELDS,
  flac: AUDIO_BOOK_FILE_WRITE_FIELDS,
} as const satisfies Record<string, readonly BookFileWriteField[]>;

export function getBookFileWriteFormatFields(format: string | null | undefined): readonly BookFileWriteField[] {
  const key = format?.toLowerCase() ?? "";
  return BOOK_FILE_WRITE_FORMAT_FIELDS[key as keyof typeof BOOK_FILE_WRITE_FORMAT_FIELDS] ?? [];
}

export type WriteResult = {
  status: "success" | "skipped" | "failed";
  fieldsWritten: string[];
  durationMs: number;
  reason?: string;
};

export type LibraryFileSyncProgressEvent =
  | { bookId: number; status: "success" | "failed" | "skipped"; reason?: string }
  | { done: true; processed: number; succeeded: number; failed: number; skipped: number };

export type WriteLogEntry = {
  id: number;
  format: string;
  status: string;
  fieldsWritten: string[];
  triggeredBy: string;
  writtenAt: string;
  durationMs: number | null;
  errorMessage: string | null;
};

export interface FileRenameResult {
  status: "success" | "skipped" | "failed";
  reason?: string;
  oldPath?: string;
  newPath?: string;
  durationMs: number;
}

export interface BookWriteAndRenameResult {
  write: WriteResult;
  rename: FileRenameResult;
  libraryAutoWriteEnabled: boolean;
  libraryAutoRenameEnabled: boolean;
}

// ── Bulk Rename ─────────────────────────────────────────────────────────────

export type BulkRenameStatus = "will_rename" | "unchanged" | "collision" | "no_pattern" | "error";

export interface BulkRenamePreviewItem {
  bookId: number;
  title: string;
  currentPath: string;
  newPath: string | null;
  status: BulkRenameStatus;
  reason?: string;
}

export interface BulkRenamePreviewPage {
  items: BulkRenamePreviewItem[];
  total: number;
  totalByStatus: Record<BulkRenameStatus, number>;
  /**
   * The naming pattern the preview was resolved against, so the client can attribute each
   * changed path segment to the pattern segment that produced it.
   */
  pattern: string;
}

/**
 * How a run is narrowed. The candidate list can run to tens of thousands and the client only
 * holds the pages it has loaded, so neither side of the selection is ever sent in full: the
 * request states whichever side is small.
 *
 * `excludeBookIds` means "rename every candidate except these" and backs the default review
 * flow, where the reviewer skips a handful. `includeBookIds` means "rename only these" and backs
 * the flow that starts from an empty selection. Sending both is rejected; sending neither
 * renames every candidate.
 */
export interface BulkRenameExecuteRequest {
  excludeBookIds?: number[];
  includeBookIds?: number[];
}

/**
 * `started` is emitted before any slow work so the response headers flush immediately and the
 * client can show real progress instead of an idle request. Its `total` is the server-narrowed
 * count, which is authoritative: the client only ever knows the pages it has loaded.
 */
export type BulkRenameProgressEvent =
  | { started: true; total: number }
  | { bookId: number; status: "success" | "failed" | "skipped"; reason?: string }
  | { done: true; processed: number; succeeded: number; failed: number; skipped: number };
