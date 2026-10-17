import type { CoverAspectRatio } from "./library";
import type { MetadataField } from "./metadata-preferences";

export interface BookMetadataFetchScoreCondition {
  enabled: boolean;
  threshold: number; // 0-100, fetch if score < threshold
}

export interface BookMetadataFetchMissingFieldsCondition {
  enabled: boolean;
  fields: MetadataField[];
}

export interface BookMetadataFetchNeverFetchedCondition {
  enabled: boolean;
}

export interface BookMetadataFetchConditions {
  scoreThreshold: BookMetadataFetchScoreCondition;
  missingFields: BookMetadataFetchMissingFieldsCondition;
  neverFetched: BookMetadataFetchNeverFetchedCondition;
}

export interface BookMetadataFetchConfig {
  enabled: boolean;
  triggerOnImport: boolean;
  conditions: BookMetadataFetchConditions;
}

export interface BookMetadataFetchConditionsOverride {
  scoreThreshold?: Partial<BookMetadataFetchScoreCondition>;
  missingFields?: Partial<BookMetadataFetchMissingFieldsCondition>;
  neverFetched?: Partial<BookMetadataFetchNeverFetchedCondition>;
}

// Stored per-library. null = inherit everything from global.
// Deep-merged by getEffectiveConfig: top-level keys first, then each conditions key individually.
export type BookMetadataFetchConfigOverride =
  | (Partial<Omit<BookMetadataFetchConfig, "conditions">> & {
      conditions?: BookMetadataFetchConditionsOverride;
    })
  | null;

// 'done' is not a queue status - rows are deleted on success to prevent unbounded growth.
export type BookMetadataFetchQueueStatus = "queued" | "processing" | "failed";

export type BookMetadataFetchReason = "event_import" | "manual_trigger" | "manual_retry";

export interface BookMetadataFetchStatus {
  queued: number;
  processing: number;
  failed: number;
  latestFailureAt: string | null;
  paused: boolean;
}

// Extends status with in-memory session progress for the progress bar in the widget.
// sessionTotal/sessionDone are reset when the queue fully drains.
// currentItemName is the title of the item currently being processed (null if none).
export interface BookMetadataFetchStatusEvent extends BookMetadataFetchStatus {
  sessionTotal: number;
  sessionDone: number;
  currentItemName: string | null;
}

// Library-level config response: effective config merged with per-library run history.
export interface BookMetadataFetchLibraryConfig extends BookMetadataFetchConfig {
  override: BookMetadataFetchConfigOverride;
  lastRunAt: string | null;
  lastQueuedCount: number | null;
}

export interface BookMetadataFetchFailedItem {
  bookId: number;
  title: string | null;
  libraryName: string | null;
  error: string | null;
  httpStatus: number | null;
  failedAt: string; // ISO string
}

export interface BookMetadataFetchFailedPage {
  items: BookMetadataFetchFailedItem[];
  total: number;
  page: number;
  limit: number;
}

/** Every books library's override and run history, from `GET /book-metadata-fetch/config/libraries`. */
export interface BookMetadataFetchLibraryConfigEntry extends BookMetadataFetchLibraryConfig {
  libraryId: number;
  libraryName: string;
}

/**
 * Body of `POST /book-metadata-fetch/preview-breakdown` and `POST /book-metadata-fetch/preview-books`.
 * `libraryIds` omitted means every books library.
 */
export interface BookMetadataFetchPreviewScope {
  conditions: BookMetadataFetchConditions;
  libraryIds?: number[];
}

/** Width of each `scoreBins` bucket: [0-4], [5-9], ... [95-100]. */
export const BOOK_METADATA_FETCH_SCORE_BIN_WIDTH = 5;

/**
 * How a rule lands on a scope. Each condition is counted on its own, whether or not it is switched on,
 * so the settings page can say what turning one on would take. `matching` honours the switches and
 * includes books that are already queued.
 */
export interface BookMetadataFetchBreakdown {
  total: number;
  matching: number;
  neverFetched: number;
  lowScore: number;
  missingAny: number;
  missingByField: Record<MetadataField, number>;
  /** Books whose files include audio; only they can lack narrators, duration, abridged or an audiobook cover. */
  withAudio: number;
  /** Scored books per 5-point bucket, lowest first; 20 entries. */
  scoreBins: number[];
  unscored: number;
}

export interface BookMetadataFetchPreviewBook {
  bookId: number;
  libraryId: number;
  title: string | null;
  author: string | null;
  metadataScore: number | null;
  neverFetched: boolean;
  /** The rule's selected fields this book lacks. */
  missingFields: MetadataField[];
  hasCover: boolean;
  coverAspectRatio: CoverAspectRatio | null;
  coverVersion: string | null;
}

export interface BookMetadataFetchPreviewBooks {
  items: BookMetadataFetchPreviewBook[];
  total: number;
}
