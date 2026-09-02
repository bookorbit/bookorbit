export const NotificationType = {
  ScanCompleted: "scan_completed",
  ScanFailed: "scan_failed",
  BooksUnavailable: "books_unavailable",
  BooksRestored: "books_restored",
  MetadataFetchCompleted: "metadata_fetch_completed",
  MetadataFetchFailed: "metadata_fetch_failed",
  BookDockFinalized: "book_dock_finalized",
  BookDockFinalizedWithErrors: "book_dock_finalized_with_errors",
  BookRequestSubmitted: "book_request_submitted",
  BookRequestApproved: "book_request_approved",
  BookRequestRejected: "book_request_rejected",
  BookRequestAvailable: "book_request_available",
  BookRequestNeedsReview: "book_request_needs_review",
  BookRequestNeedsRelease: "book_request_needs_release",
  BookRequestFailed: "book_request_failed",
  AuthorEnrichmentCompleted: "author_enrichment_completed",
  AuthorEnrichmentFailed: "author_enrichment_failed",
  EmailSent: "email_sent",
  EmailFailed: "email_failed",
  MigrationCompleted: "migration_completed",
  MigrationFailed: "migration_failed",
  FileWriteBackCompleted: "file_write_back_completed",
  FileWriteBackFailed: "file_write_back_failed",
  FileRenameCompleted: "file_rename_completed",
  FileRenameFailed: "file_rename_failed",
  BulkRenameCompleted: "bulk_rename_completed",
  BulkRenameFailed: "bulk_rename_failed",
  AchievementUnlocked: "achievement_unlocked",
} as const;

export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

/**
 * `warning` is a partial success: the operation delivered but something inside it did not.
 * It must reach a user who asked to hear about problems, which is why `problems` admits
 * both `warning` and `error`.
 */
export const NotificationSeverity = {
  Success: "success",
  Warning: "warning",
  Error: "error",
} as const;

export type NotificationSeverity = (typeof NotificationSeverity)[keyof typeof NotificationSeverity];

export const NOTIFICATION_CATEGORY_IDS = [
  "scanning",
  "metadata",
  "bookDock",
  "bookRequests",
  "authorEnrichment",
  "email",
  "migration",
  "fileWriteBack",
  "fileRename",
  "bulkRename",
  "achievements",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORY_IDS)[number];

export interface NotificationTypeMeta {
  category: NotificationCategory;
  severity: NotificationSeverity;
}

/**
 * Single source of truth for what a notification type *is*. Anything that needs to know a type's
 * category, colour, icon or severity reads it from here. Keeping a parallel copy on the client is
 * what let `bulk_rename_failed` render as a success for as long as it did.
 */
export const NOTIFICATION_TYPE_META: Record<NotificationType, NotificationTypeMeta> = {
  [NotificationType.ScanCompleted]: { category: "scanning", severity: "success" },
  [NotificationType.ScanFailed]: { category: "scanning", severity: "error" },
  [NotificationType.BooksUnavailable]: { category: "scanning", severity: "warning" },
  [NotificationType.BooksRestored]: { category: "scanning", severity: "success" },
  [NotificationType.MetadataFetchCompleted]: { category: "metadata", severity: "success" },
  [NotificationType.MetadataFetchFailed]: { category: "metadata", severity: "warning" },
  [NotificationType.BookDockFinalized]: { category: "bookDock", severity: "success" },
  [NotificationType.BookDockFinalizedWithErrors]: { category: "bookDock", severity: "warning" },
  [NotificationType.BookRequestSubmitted]: { category: "bookRequests", severity: "success" },
  [NotificationType.BookRequestApproved]: { category: "bookRequests", severity: "success" },
  [NotificationType.BookRequestRejected]: { category: "bookRequests", severity: "warning" },
  [NotificationType.BookRequestAvailable]: { category: "bookRequests", severity: "success" },
  [NotificationType.BookRequestNeedsReview]: { category: "bookRequests", severity: "warning" },
  [NotificationType.BookRequestNeedsRelease]: { category: "bookRequests", severity: "warning" },
  [NotificationType.BookRequestFailed]: { category: "bookRequests", severity: "error" },
  [NotificationType.AuthorEnrichmentCompleted]: { category: "authorEnrichment", severity: "success" },
  [NotificationType.AuthorEnrichmentFailed]: { category: "authorEnrichment", severity: "warning" },
  [NotificationType.EmailSent]: { category: "email", severity: "success" },
  [NotificationType.EmailFailed]: { category: "email", severity: "error" },
  [NotificationType.MigrationCompleted]: { category: "migration", severity: "success" },
  [NotificationType.MigrationFailed]: { category: "migration", severity: "error" },
  [NotificationType.FileWriteBackCompleted]: { category: "fileWriteBack", severity: "success" },
  [NotificationType.FileWriteBackFailed]: { category: "fileWriteBack", severity: "error" },
  [NotificationType.FileRenameCompleted]: { category: "fileRename", severity: "success" },
  [NotificationType.FileRenameFailed]: { category: "fileRename", severity: "error" },
  [NotificationType.BulkRenameCompleted]: { category: "bulkRename", severity: "success" },
  [NotificationType.BulkRenameFailed]: { category: "bulkRename", severity: "warning" },
  [NotificationType.AchievementUnlocked]: { category: "achievements", severity: "success" },
};

export const NOTIFICATION_CATEGORIES: Record<NotificationCategory, readonly NotificationType[]> = NOTIFICATION_CATEGORY_IDS.reduce(
  (acc, category) => {
    acc[category] = (Object.keys(NOTIFICATION_TYPE_META) as NotificationType[]).filter((type) => NOTIFICATION_TYPE_META[type].category === category);
    return acc;
  },
  {} as Record<NotificationCategory, readonly NotificationType[]>,
);

export const NotificationLevel = {
  Off: "off",
  /** Warnings and errors only. */
  Problems: "problems",
  All: "all",
} as const;

export type NotificationLevel = (typeof NotificationLevel)[keyof typeof NotificationLevel];

export type NotificationPreferences = {
  [K in NotificationCategory]?: NotificationLevel | boolean;
};

const PROBLEM_SEVERITIES: readonly NotificationSeverity[] = [NotificationSeverity.Warning, NotificationSeverity.Error];

export function isProblemSeverity(severity: NotificationSeverity): boolean {
  return PROBLEM_SEVERITIES.includes(severity);
}

/**
 * Categories with no warning or error member cannot express "problems only"; there, the level
 * would silently mean the same as "off". Callers use this to render a two-state toggle instead of
 * offering a third option that does nothing.
 */
export function categorySupportsProblemsLevel(category: NotificationCategory): boolean {
  return NOTIFICATION_CATEGORIES[category].some((type) => isProblemSeverity(NOTIFICATION_TYPE_META[type].severity));
}

export function availableLevelsForCategory(category: NotificationCategory): readonly NotificationLevel[] {
  return categorySupportsProblemsLevel(category)
    ? [NotificationLevel.Off, NotificationLevel.Problems, NotificationLevel.All]
    : [NotificationLevel.Off, NotificationLevel.All];
}

function isNotificationLevel(value: unknown): value is NotificationLevel {
  return value === NotificationLevel.Off || value === NotificationLevel.Problems || value === NotificationLevel.All;
}

/**
 * Accepts the legacy boolean shape so stored preferences need no migration:
 * `false` meant "category off", anything else meant "send everything".
 */
export function resolveNotificationLevel(raw: unknown): NotificationLevel {
  if (raw === false) return NotificationLevel.Off;
  if (raw === true || raw === undefined || raw === null) return NotificationLevel.All;
  return isNotificationLevel(raw) ? raw : NotificationLevel.All;
}

export function isNotificationAllowed(level: NotificationLevel, severity: NotificationSeverity): boolean {
  if (level === NotificationLevel.Off) return false;
  if (level === NotificationLevel.All) return true;
  return isProblemSeverity(severity);
}

export interface NotificationItem {
  id: number;
  type: NotificationType;
  title: string;
  message: string | null;
  actionUrl: string | null;
  meta: Record<string, unknown> | null;
  read: boolean;
  /** Number of occurrences collapsed into this row. 1 for an uncollapsed notification. */
  count: number;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationPage {
  items: NotificationItem[];
  total: number;
}
