import type { MetadataField } from './metadata-preferences';

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

// Stored per-library. null = inherit everything from global.
// Deep-merged by getEffectiveConfig: top-level keys first, then each conditions key individually.
export type BookMetadataFetchConfigOverride = Partial<BookMetadataFetchConfig> | null;

// 'done' is not a queue status — rows are deleted on success to prevent unbounded growth.
export type BookMetadataFetchQueueStatus = 'queued' | 'processing' | 'failed';

export type BookMetadataFetchReason = 'event_import' | 'manual_trigger' | 'manual_retry';

export interface BookMetadataFetchStatus {
  queued: number;
  processing: number;
  failed: number;
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
