/**
 * Semantic filter field names used in rules.
 *
 * Most fields map directly to a DB column. The exceptions:
 * - `fileAvailability` - derived from `books.status` ('present' | 'missing')
 * - `readProgress` - aggregated from `reading_progress.percentage` (per-user, per-book-file)
 * - `readStatus` - stored in `user_book_status.status` (per-user)
 * - `startedAt` - from `user_book_status.started_at` (per-user)
 * - `finishedAt` - from `user_book_status.finished_at` (per-user)
 * - `author` - resolved via `book_authors` join to `authors.name`
 * - `genre` - resolved via `book_genres` join to `genres.name`
 * - `tag` - resolved via `book_tags` join to `tags.name`
 * - `collection` - resolved via `collection_books` join to `collections.name`
 * - `library` - resolved via `books.library_id` join to `libraries.name`
 * - `format` - resolved via `book_files.format` (primary file)
 * - `isbn` - matches both `isbn10` and `isbn13` in `book_metadata`
 * - `lockStatus` - derived from `book_metadata.locked_fields` (non-empty array = locked)
 * - `seriesStatus` - computed per-user: "up next in series" (next unstarted book whose earlier series entries are all finished)
 */
export type RuleField =
  | "title"
  | "publisher"
  | "language"
  | "series"
  | "seriesIndex"
  | "publishedYear"
  | "pageCount"
  | "author"
  | "genre"
  | "tag"
  | "collection"
  | "library"
  | "format"
  | "addedAt"
  | "startedAt"
  | "finishedAt"
  | "fileAvailability"
  | "rating"
  | "readProgress"
  | "readStatus"
  | "description"
  | "isbn"
  | "metadataScore"
  | "cover"
  | "lockStatus"
  | "seriesStatus";

export type RuleOperator =
  | "contains"
  | "notContains"
  | "startsWith"
  | "endsWith"
  | "eq"
  | "notEq"
  | "isEmpty"
  | "isNotEmpty"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "includesAny"
  | "includesAll"
  | "excludesAll"
  | "before"
  | "after"
  | "withinLast"
  | "isMissing"
  | "isPresent"
  | "isUnread"
  | "isInProgress"
  | "isFinished"
  | "isLocked"
  | "isUnlocked"
  | "isUpNext";

export const FIELD_OPERATORS: Record<RuleField, RuleOperator[]> = {
  title: ["contains", "notContains", "startsWith", "endsWith", "eq", "notEq", "isEmpty", "isNotEmpty"],
  publisher: ["contains", "notContains", "eq", "notEq", "includesAny", "excludesAll", "isEmpty", "isNotEmpty"],
  language: ["eq", "notEq", "includesAny", "excludesAll", "isEmpty", "isNotEmpty"],
  series: ["contains", "notContains", "eq", "notEq", "includesAny", "excludesAll", "isEmpty", "isNotEmpty"],
  author: ["includesAny", "includesAll", "excludesAll", "isEmpty", "isNotEmpty"],
  genre: ["includesAny", "includesAll", "excludesAll", "isEmpty", "isNotEmpty"],
  tag: ["includesAny", "includesAll", "excludesAll", "isEmpty", "isNotEmpty"],
  collection: ["includesAny", "excludesAll", "isEmpty", "isNotEmpty"],
  library: ["includesAny", "excludesAll"],
  format: ["includesAny", "excludesAll"],
  publishedYear: ["eq", "notEq", "gt", "gte", "lt", "lte", "between", "isEmpty", "isNotEmpty"],
  seriesIndex: ["eq", "notEq", "gt", "gte", "lt", "lte", "between", "isEmpty", "isNotEmpty"],
  pageCount: ["gt", "gte", "lt", "lte", "between", "isEmpty", "isNotEmpty"],
  addedAt: ["before", "after", "between", "withinLast"],
  startedAt: ["before", "after", "between", "withinLast", "isEmpty", "isNotEmpty"],
  finishedAt: ["before", "after", "between", "withinLast", "isEmpty", "isNotEmpty"],
  fileAvailability: ["isMissing", "isPresent"],
  rating: ["eq", "gt", "gte", "lt", "lte", "isEmpty", "isNotEmpty"],
  readProgress: ["isUnread", "isInProgress", "isFinished"],
  readStatus: ["includesAny", "excludesAll", "isEmpty", "isNotEmpty"],
  description: ["isEmpty", "isNotEmpty"],
  isbn: ["isEmpty", "isNotEmpty", "eq"],
  metadataScore: ["gt", "gte", "lt", "lte", "between", "isEmpty", "isNotEmpty"],
  cover: ["isMissing", "isPresent"],
  lockStatus: ["isLocked", "isUnlocked"],
  seriesStatus: ["isUpNext"],
};

export const RULE_FIELDS = Object.keys(FIELD_OPERATORS) as RuleField[];

export const RULE_OPERATORS: RuleOperator[] = [
  "contains",
  "notContains",
  "startsWith",
  "endsWith",
  "eq",
  "notEq",
  "isEmpty",
  "isNotEmpty",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "includesAny",
  "includesAll",
  "excludesAll",
  "before",
  "after",
  "withinLast",
  "isMissing",
  "isPresent",
  "isUnread",
  "isInProgress",
  "isFinished",
  "isLocked",
  "isUnlocked",
  "isUpNext",
];

export type Rule = {
  type: "rule";
  field: RuleField;
  operator: RuleOperator;
  value?: string | number | string[] | number[];
  valueTo?: string | number;
};

export type GroupRule = {
  type: "group";
  join: "AND" | "OR";
  rules: (Rule | GroupRule)[];
};

/**
 * Semantic sort field names used in sort specs.
 *
 * Most fields map directly to `book_metadata` columns. The exceptions:
 * - `author` - sorts by first author's `sort_name` via `book_authors` → `authors` join
 * - `fileSize` - fetched from `book_files.size_bytes` for the primary file (correlated subquery)
 * - `readProgress` - aggregated from `reading_progress.percentage` (per-user, correlated subquery)
 * - `readStatus` - from `user_book_status.status` (per-user, correlated subquery)
 * - `lastReadAt` - max `reading_progress.updated_at` across all files (per-user, correlated subquery)
 * - `startedAt` - from `user_book_status.started_at` (per-user, correlated subquery)
 * - `finishedAt` - from `user_book_status.finished_at` (per-user, correlated subquery)
 * - `rating` - from `user_book_ratings.rating` (per-user, correlated subquery)
 * - `format` - from `book_files.format` for the primary file (correlated subquery)
 * - `random` - day-seeded pseudorandom based on book id and user id
 *
 * Fields marked "per-user, correlated subquery" require an authenticated userId and
 * execute a subquery per result row; they are slower on large result sets.
 */
export type SortField =
  | "author"
  | "title"
  | "series"
  | "seriesIndex"
  | "addedAt"
  | "updatedAt"
  | "publishedYear"
  | "pageCount"
  | "rating"
  | "publisher"
  | "fileSize"
  | "readProgress"
  | "readStatus"
  | "format"
  | "lastReadAt"
  | "startedAt"
  | "finishedAt"
  | "random"
  | "language"
  | "metadataScore";

export const SORT_FIELDS: SortField[] = [
  "author",
  "title",
  "series",
  "seriesIndex",
  "addedAt",
  "updatedAt",
  "publishedYear",
  "pageCount",
  "rating",
  "publisher",
  "fileSize",
  "readProgress",
  "readStatus",
  "format",
  "lastReadAt",
  "startedAt",
  "finishedAt",
  "random",
  "language",
  "metadataScore",
];

export type SortSpec = {
  field: SortField;
  dir: "asc" | "desc";
};

export type BookQuery = {
  filter?: GroupRule;
  sort: SortSpec[];
  pagination: { page: number; size: number };
  collapseSeries?: boolean;
  q?: string;
};
