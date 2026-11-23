import type { StoryGuidesAppInfo } from "./story-guide";
import type { ReadingHelpAppInfo } from "./reading-help";
import type { VisionScanAppInfo } from "./vision-scan";

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
  /** `PATCH /authors/:id` accepts `gender`, and book filters accept the `authorGender` field. */
  "author-gender",
  /** Book filters accept the `storyGuide` field for built Story Guide artifacts. */
  "story-guide-filter",
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
  /** The `format` book filter accepts `epub:plain` for EPUBs without media overlays. */
  "plain-epub-filter",
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
  /** `POST /mobile/books/files/:fileId/locate-text` finds where text recognised on a photographed page appears in an EPUB. */
  "locate-text",
  /** `GET /mobile/year-review/:year`: a reader's year, for the app's Year in Review story. */
  "year-review",
  /**
   * `POST /mobile/visual-match` names the books in the reader's libraries that text recognised on a
   * photographed cover or spine, or its barcode, points to.
   */
  "visual-match",
  /**
   * `POST /mobile/shelf-match` names, for each spine in a photographed shelf, the books in the
   * reader's libraries that the text recognised on it points to.
   */
  "shelf-match",
  /**
   * `GET /mobile/books/:bookId/story-edits` pages a reader's corrections to a book's people, places
   * and terms by revision cursor, and `PUT /mobile/books/:bookId/story-edits/:id` writes one.
   */
  "story-edits",
  /**
   * `POST /books/merge/preview`, `POST /books/merge` and `GET /books/merge/jobs/:jobId`; a merged-away
   * book id answers 404 with `errorCode: "BOOK_MERGED"` and `errorMeta.targetBookId`, and queued writes
   * to it land on the kept book.
   */
  "book-merge",
  /**
   * `POST /books/links`, `PATCH /books/links/:groupId`, `DELETE /books/:id/link`; book queries accept
   * `collapseLinked`, cards carry `linked` and `BooksPage.bookTotal`, and book detail `linkedBooks`.
   */
  "book-links",
  /**
   * `POST /app-attest/android-keys` registers an Android Key Attestation key, and the routes App
   * Attest guards accept its signature with `X-BookOrbit-Attest-Nonce` beside the other three headers.
   */
  "android-key-attest",
  /**
   * `GET /books/:bookId/story-guide` with its build, retry, cancel and delete routes, and
   * `GET /mobile/books/files/:fileId/story-guide` for the guide itself. `app-info` carries
   * `storyGuides`.
   */
  "story-guides",
  /**
   * `GET /mobile/books/files/:fileId/story-guide/fixes` pages the fixes made to a text's story guide
   * for everyone by revision cursor, with the ones that find no target marked, and
   * `PUT /mobile/books/files/:fileId/story-guide/fixes/:id` writes one. The guide is served with them
   * applied, and its status carries `guide.orphanedFixes`.
   */
  "story-guide-fixes",
  /**
   * `POST /mobile/vision-scan` reads the books in a photo of a cover or a shelf with the admin's AI
   * model and matches them to the reader's libraries. `app-info` carries `visionScan`.
   */
  "vision-scan",
  /**
   * `POST /mobile/reading-help` writes a short answer about passages of a book with the admin's AI
   * model and streams it back. `app-info` carries `readingHelp`.
   */
  "reading-help",
  /**
   * `POST /books/:id/embed-audio-cover` and `POST /books/bulk-embed-audio-cover` write a book's square
   * audiobook cover into its read-along EPUBs. The single route answers a `WriteResult` with `code`
   * (`AudioCoverEmbedCode`), where a client that does not know a code reads `status`.
   */
  "audio-cover-embed",
  /**
   * Linked books are editions of one work. Book detail always carries `editionName` and
   * `originalPublishedYear` (null when unset) and both are editable and lockable; `linkedBooks`
   * members carry the edition fields and the viewer's progress; a folded card stands for the edition
   * the viewer read last; `GET /series/:id/books` and `GET /authors/:id/books` accept
   * `collapseLinked`; series and author summaries carry `workCount`.
   */
  "book-editions",
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
  /** Whether story guides can be built and whether any exists; absent on servers without them. */
  storyGuides?: StoryGuidesAppInfo;
  /** Whether photo scans can run now; absent on servers without them. */
  visionScan?: VisionScanAppInfo;
  /** Whether reading help can answer now; absent on servers without it. */
  readingHelp?: ReadingHelpAppInfo;
}

/** Public, credential-free identity check for explicitly enrolled connection aliases. */
export interface ServerIdentityResponse {
  product: "bookorbit";
  protocolVersion: 1;
  instanceId: string;
}
