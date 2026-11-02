/**
 * Capabilities this server supports, advertised so a client can tell a newer server from an
 * older one before sending a field or calling a route the older one would reject. Append only:
 * a released client reads this list, so a value is never renamed or removed.
 */
export const SERVER_FEATURES = [
  "annotation-stars",
  "annotation-color-names",
  "annotation-trash",
  "book-journal",
  "bookmark-edit",
  "notebook-hub",
  "book-request-pairs",
  /** Metadata searches (book and author) accept `cache=refresh` and mark candidates answered from the cache. */
  "metadata-search-cache",
  "read-aloud-delivery",
  "koreader-delivery-settings",
  "server-connection-identity",
  /** `GET /books/:id/annotations` and `/bookmarks` accept `readerFileId` and return positions for that file. */
  "reader-file-positions",
  /**
   * `POST .../grab` accepts `holdForReview`, release candidates carry `infoUrl`, and a held
   * review reports `heldOnRequest`, `releaseInfoUrl`, `edition` and `hasCover` with a cover route.
   */
  "book-request-review-hold",
  /**
   * `PATCH /authors/:id` accepts `website`, `birthDate`, `birthYear`, `deathDate`, `deathYear`,
   * `genres` and `influences`, and `PUT`/`DELETE /authors/:id/metadata-match` pin or unpin the
   * provider match.
   */
  "author-metadata-match",
  /**
   * `GET /metadata-fetch/stream` accepts `resultsPerProvider` (up to
   * `METADATA_SEARCH_MAX_RESULTS_PER_PROVIDER`), and Open Library and Hardcover answer a search that
   * names an author but no title.
   */
  "metadata-search-results-per-provider",
  /** Book and custom date filters accept the `moreThanAgo` rolling-boundary operator. */
  "relative-date-ranges",
  /** The `format` book filter accepts `epub:readalong` for EPUBs with media overlays. */
  "read-along-filter",
  /**
   * `GET /reading-history` (offset pages, the first carrying every month's size), `/summary`,
   * `/:attemptId/marks` and `PATCH /:attemptId/rating`.
   */
  "reading-history",
  /**
   * `GET`/`PUT /reading-progress` and `DELETE /reading-progress/:fileId`: positions grouped by
   * kind, several files saved in one request, and `editedAt` so the newer of two saves wins.
   */
  "reading-progress",
] as const;

export type ServerFeature = (typeof SERVER_FEATURES)[number];

export interface AppInfoResponse {
  /** Stable installation identity, absent on older servers. */
  instanceId?: string;
  version: string;
  updateAvailable: boolean | null;
  latestVersion: string | null;
  maxUploadSizeMb: number;
  /** Absent on servers older than the field itself, which a client treats as an empty list. */
  features?: ServerFeature[];
}

/** Public, credential-free identity check for explicitly enrolled connection aliases. */
export interface ServerIdentityResponse {
  product: "bookorbit";
  protocolVersion: 1;
  instanceId: string;
}
