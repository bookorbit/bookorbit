export const NotificationType = {
  ScanCompleted: "scan_completed",
  ScanFailed: "scan_failed",
  BooksUnavailable: "books_unavailable",
  BooksRestored: "books_restored",
  MetadataFetchCompleted: "metadata_fetch_completed",
  MetadataFetchFailed: "metadata_fetch_failed",
  BookDockReady: "book_dock_ready",
  BookDockFinalized: "book_dock_finalized",
  AuthorEnrichmentCompleted: "author_enrichment_completed",
  AuthorEnrichmentFailed: "author_enrichment_failed",
  EmailSent: "email_sent",
  EmailFailed: "email_failed",
  KoboSyncCompleted: "kobo_sync_completed",
  MigrationCompleted: "migration_completed",
  MigrationFailed: "migration_failed",
  FileWriteBackCompleted: "file_write_back_completed",
  FileWriteBackFailed: "file_write_back_failed",
  FileRenameCompleted: "file_rename_completed",
  FileRenameFailed: "file_rename_failed",
  AchievementUnlocked: "achievement_unlocked",
} as const;

export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const NOTIFICATION_CATEGORIES = {
  scanning: [NotificationType.ScanCompleted, NotificationType.ScanFailed, NotificationType.BooksUnavailable, NotificationType.BooksRestored],
  metadata: [NotificationType.MetadataFetchCompleted, NotificationType.MetadataFetchFailed],
  bookDock: [NotificationType.BookDockReady, NotificationType.BookDockFinalized],
  authorEnrichment: [NotificationType.AuthorEnrichmentCompleted, NotificationType.AuthorEnrichmentFailed],
  email: [NotificationType.EmailSent, NotificationType.EmailFailed],
  koboSync: [NotificationType.KoboSyncCompleted],
  migration: [NotificationType.MigrationCompleted, NotificationType.MigrationFailed],
  fileWriteBack: [NotificationType.FileWriteBackCompleted, NotificationType.FileWriteBackFailed],
  fileRename: [NotificationType.FileRenameCompleted, NotificationType.FileRenameFailed],
  achievements: [NotificationType.AchievementUnlocked],
} as const;

export type NotificationCategory = keyof typeof NOTIFICATION_CATEGORIES;

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  scanning: "Library Scanning",
  metadata: "Metadata Fetching",
  bookDock: "Book Dock",
  authorEnrichment: "Author Enrichment",
  email: "Email Delivery",
  koboSync: "Kobo Sync",
  migration: "Data Migration",
  fileWriteBack: "File Write-back",
  fileRename: "File Rename",
  achievements: "Achievements",
};

export type NotificationPreferences = {
  [K in NotificationCategory]?: boolean;
};

export interface NotificationItem {
  id: number;
  type: NotificationType;
  title: string;
  message: string | null;
  actionUrl: string | null;
  meta: Record<string, unknown> | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationPage {
  items: NotificationItem[];
  total: number;
}
