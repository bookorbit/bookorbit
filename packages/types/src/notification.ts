export const NotificationType = {
  ScanCompleted: "scan_completed",
  ScanFailed: "scan_failed",
  BooksUnavailable: "books_unavailable",
  BooksRestored: "books_restored",
  MetadataFetchCompleted: "metadata_fetch_completed",
  MetadataFetchFailed: "metadata_fetch_failed",
  BookBucketReady: "book_bucket_ready",
  BookBucketFinalized: "book_bucket_finalized",
  AuthorEnrichmentCompleted: "author_enrichment_completed",
  AuthorEnrichmentFailed: "author_enrichment_failed",
  EmailSent: "email_sent",
  EmailFailed: "email_failed",
  KoboSyncCompleted: "kobo_sync_completed",
  MigrationCompleted: "migration_completed",
  MigrationFailed: "migration_failed",
  FileWriteBackCompleted: "file_write_back_completed",
  FileWriteBackFailed: "file_write_back_failed",
} as const;

export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const NOTIFICATION_CATEGORIES = {
  scanning: [NotificationType.ScanCompleted, NotificationType.ScanFailed, NotificationType.BooksUnavailable, NotificationType.BooksRestored],
  metadata: [NotificationType.MetadataFetchCompleted, NotificationType.MetadataFetchFailed],
  bookBucket: [NotificationType.BookBucketReady, NotificationType.BookBucketFinalized],
  authorEnrichment: [NotificationType.AuthorEnrichmentCompleted, NotificationType.AuthorEnrichmentFailed],
  email: [NotificationType.EmailSent, NotificationType.EmailFailed],
  koboSync: [NotificationType.KoboSyncCompleted],
  migration: [NotificationType.MigrationCompleted, NotificationType.MigrationFailed],
  fileWriteBack: [NotificationType.FileWriteBackCompleted, NotificationType.FileWriteBackFailed],
} as const;

export type NotificationCategory = keyof typeof NOTIFICATION_CATEGORIES;

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  scanning: "Library Scanning",
  metadata: "Metadata Fetching",
  bookBucket: "Book Bucket",
  authorEnrichment: "Author Enrichment",
  email: "Email Delivery",
  koboSync: "Kobo Sync",
  migration: "Data Migration",
  fileWriteBack: "File Write-back",
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
