export enum Permission {
  // Content
  LibraryDownload = "library_download",
  LibraryUpload = "library_upload",
  LibraryEditMetadata = "library_edit_metadata",
  LibraryDeleteBooks = "library_delete_books",
  DemoRestricted = "demo_restricted",

  // Devices & Access
  KoboSync = "kobo_sync",
  KoreaderSync = "koreader_sync",
  HardcoverSync = "hardcover_sync",
  OpdsAccess = "opds_access",
  BookDockAccess = "book_dock_access",

  // Email
  EmailSend = "email_send",
  ManageEmail = "manage_email",

  // Administration
  ManageLibraries = "manage_libraries",
  ManageMetadataConfig = "manage_metadata_config",
  ManageIcons = "manage_icons",
  ManageAppSettings = "manage_app_settings",
  ManageUsers = "manage_users",
  ViewAuditLog = "view_audit_log",

  // Notifications
  NotificationAccess = "notification_access",
}

export const PERMISSION_LABELS: Record<Permission, string> = {
  [Permission.LibraryDownload]: "Download books",
  [Permission.LibraryUpload]: "Upload books",
  [Permission.LibraryEditMetadata]: "Edit metadata",
  [Permission.LibraryDeleteBooks]: "Delete books",
  [Permission.DemoRestricted]: "Demo restricted",
  [Permission.KoboSync]: "Kobo sync",
  [Permission.KoreaderSync]: "KOReader sync",
  [Permission.HardcoverSync]: "Hardcover sync",
  [Permission.OpdsAccess]: "OPDS access",
  [Permission.BookDockAccess]: "Book Dock",
  [Permission.EmailSend]: "Send by email",
  [Permission.ManageEmail]: "Manage email",
  [Permission.ManageLibraries]: "Manage libraries",
  [Permission.ManageMetadataConfig]: "Metadata config",
  [Permission.ManageIcons]: "Manage icons",
  [Permission.ManageAppSettings]: "App settings",
  [Permission.ManageUsers]: "Manage users",
  [Permission.ViewAuditLog]: "View audit log",
  [Permission.NotificationAccess]: "Notifications",
};
