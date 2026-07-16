export type StorygraphSyncDisabledReason = "permission_denied" | "missing_cookies" | "user_disabled";
export type StorygraphBookSyncMode = "all_eligible" | "selected_only";

export interface StorygraphSettings {
  cookiesConfigured: boolean;
  enabled: boolean;
  effectiveEnabled: boolean;
  disabledReason: StorygraphSyncDisabledReason | null;
  bookSyncMode: StorygraphBookSyncMode;
  autoSyncOnStatusChange: boolean;
  autoSyncOnProgressUpdate: boolean;
  lastSyncedAt: string | null;
}

export interface UpsertStorygraphSettingsPayload {
  sessionCookie?: string;
  rememberToken?: string;
  enabled?: boolean;
  bookSyncMode?: StorygraphBookSyncMode;
  autoSyncOnStatusChange?: boolean;
  autoSyncOnProgressUpdate?: boolean;
}

export interface StorygraphCookieValidationResult {
  valid: boolean;
}

export type StorygraphSyncRunStatus = "running" | "completed" | "failed" | "cancelled";

export interface StorygraphSyncPendingSummary {
  totalBooks: number;
  pendingBooks: number;
}

export type StorygraphBookSyncOverride = "included" | "excluded" | null;

export type StorygraphBookSyncEffectiveReason =
  StorygraphSyncDisabledReason | "global_disabled" | "not_selected" | "excluded" | "unread" | "unsupported_status";

export interface StorygraphBookSyncState {
  bookId: number;
  syncOverride: StorygraphBookSyncOverride;
  syncEnabled: boolean;
  canSyncNow: boolean;
  effectiveReason: StorygraphBookSyncEffectiveReason | null;
  lastSyncedAt: string | null;
  syncError: string | null;
}

export interface UpdateStorygraphBookSyncPayload {
  syncEnabled: boolean;
}

export interface StorygraphBookSyncNowResult {
  result: "synced" | "skipped" | "failed";
  state: StorygraphBookSyncState;
}

export interface StorygraphActiveSyncStatus {
  runId: number;
  syncedBooks: number;
  skippedBooks: number;
  failedBooks: number;
  processedBooks: number;
  totalBooks: number;
  status: StorygraphSyncRunStatus;
}

export interface StorygraphSyncFailure {
  bookId: number;
  title: string;
  authorName: string | null;
  syncError: string;
  lastAttemptAt: string | null;
}

export interface StorygraphEdition {
  id: string;
  title: string;
  format: string;
  pages: number | null;
  isAudio: boolean;
  language: string | null;
  isbn: string | null;
  publisher: string | null;
  publicationDate: string | null;
  coverUrl: string | null;
}

export interface StorygraphLinkedBook {
  bookId: number;
  title: string | null;
  authorName: string | null;
  storygraphBookId: string | null;
  matchMethod: string | null;
  matchError: string | null;
}

export interface StorygraphLinkResult {
  success: boolean;
  storygraphBookId?: string;
  title?: string;
}
