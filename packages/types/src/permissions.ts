export enum Permission {
  // Content
  LibraryDownload = "library_download",
  LibraryUpload = "library_upload",
  LibraryEditMetadata = "library_edit_metadata",
  LibraryDeleteBooks = "library_delete_books",

  // Devices & Access
  KoboSync = "kobo_sync",
  OpdsAccess = "opds_access",
  StagingAccess = "staging_access",

  // Email
  EmailSend = "email_send",
  ManageEmail = "manage_email",

  // Administration
  ManageLibraries = "manage_libraries",
  ManageMetadataConfig = "manage_metadata_config",
  ManageAppSettings = "manage_app_settings",
  ManageUsers = "manage_users",
}

export const PERMISSION_LABELS: Record<Permission, string> = {
  [Permission.LibraryDownload]: "Download books",
  [Permission.LibraryUpload]: "Upload books",
  [Permission.LibraryEditMetadata]: "Edit metadata",
  [Permission.LibraryDeleteBooks]: "Delete books",
  [Permission.KoboSync]: "Kobo sync",
  [Permission.OpdsAccess]: "OPDS access",
  [Permission.StagingAccess]: "Staging / bookdrop",
  [Permission.EmailSend]: "Send by email",
  [Permission.ManageEmail]: "Manage email",
  [Permission.ManageLibraries]: "Manage libraries",
  [Permission.ManageMetadataConfig]: "Metadata config",
  [Permission.ManageAppSettings]: "App settings",
  [Permission.ManageUsers]: "Manage users",
};
