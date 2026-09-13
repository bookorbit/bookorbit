export enum Permission {
  // Content
  LibraryDownload = "library_download",
  LibraryUpload = "library_upload",
  LibraryEditMetadata = "library_edit_metadata",
  LibraryDeleteBooks = "library_delete_books",
  BookDockAccess = "book_dock_access",
  BookRequestAccess = "book_request_access",
  DemoRestricted = "demo_restricted",

  // Devices & Access
  KoboSync = "kobo_sync",
  KoreaderSync = "koreader_sync",
  HardcoverSync = "hardcover_sync",
  ReadwiseSync = "readwise_sync",
  StorygraphSync = "storygraph_sync",
  OpdsAccess = "opds_access",

  // Email
  EmailSend = "email_send",
  ManageEmail = "manage_email",

  // Administration
  ManageLibraries = "manage_libraries",
  ManageMetadataConfig = "manage_metadata_config",
  ManageIcons = "manage_icons",
  ManageAppSettings = "manage_app_settings",
  ManageBookDock = "manage_book_dock",
  ManageBookRequests = "manage_book_requests",
  BookRequestAutoApprove = "book_request_auto_approve",
  BookRequestSelfFulfill = "book_request_self_fulfill",
  ManageUsers = "manage_users",
  ViewUserActivity = "view_user_activity",
  ViewAuditLog = "view_audit_log",

  // Notifications
  NotificationAccess = "notification_access",
}

export const PERMISSION_LABELS: Record<Permission, string> = {
  [Permission.LibraryDownload]: "Download books",
  [Permission.LibraryUpload]: "Upload books",
  [Permission.LibraryEditMetadata]: "Edit metadata",
  [Permission.LibraryDeleteBooks]: "Delete books",
  [Permission.BookDockAccess]: "Book Dock",
  [Permission.BookRequestAccess]: "Request books",
  [Permission.DemoRestricted]: "Demo restricted",
  [Permission.KoboSync]: "Kobo sync",
  [Permission.KoreaderSync]: "KOReader sync",
  [Permission.HardcoverSync]: "Hardcover sync",
  [Permission.ReadwiseSync]: "Readwise sync",
  [Permission.StorygraphSync]: "StoryGraph sync",
  [Permission.OpdsAccess]: "OPDS access",
  [Permission.EmailSend]: "Send by email",
  [Permission.ManageEmail]: "Manage email",
  [Permission.ManageLibraries]: "Manage libraries",
  [Permission.ManageMetadataConfig]: "Metadata config",
  [Permission.ManageIcons]: "Manage icons",
  [Permission.ManageAppSettings]: "App settings",
  [Permission.ManageBookDock]: "Manage Book Dock",
  [Permission.ManageBookRequests]: "Manage book requests",
  [Permission.BookRequestAutoApprove]: "Auto-approve requests",
  [Permission.BookRequestSelfFulfill]: "Download books directly",
  [Permission.ManageUsers]: "Manage users",
  [Permission.ViewUserActivity]: "View user activity",
  [Permission.ViewAuditLog]: "View audit log",
  [Permission.NotificationAccess]: "Notifications",
};

/**
 * Permissions that are inert without another one, and the dependency is enforced when permissions
 * are assigned rather than implied when they are checked.
 *
 * Implying at check time would be the shorter fix and the wrong one: a token holding only
 * `BookRequestSelfFulfill` would start passing every `BookRequestAccess` route, which is exactly
 * the claim the authorization matrix exists to make and would no longer be true.
 */
export const PERMISSION_REQUIRES: Partial<Record<Permission, readonly Permission[]>> = {
  // Self-fulfilment adds a way to fulfil a request. Listing, viewing and the live queue all
  // answer to `BookRequestAccess`, so granting one without the other buys nothing at all.
  [Permission.BookRequestSelfFulfill]: [Permission.BookRequestAccess],
  // Moderating the queue is a superset of using it, not a separate thing: the summary, the detail
  // route, the websocket, and the moderator branches of cancel and language all sit behind
  // `BookRequestAccess`. Granted alone this produced an approver with no sidebar entry who was
  // refused by every route except the queue list.
  [Permission.ManageBookRequests]: [Permission.BookRequestAccess],
  // Auto-approve only decides what happens to a request the holder submits, so it says nothing
  // at all without the permission that lets them submit one.
  [Permission.BookRequestAutoApprove]: [Permission.BookRequestAccess],
};

/** Every permission the given selection implies must also be held, itself included. */
export function withRequiredPermissions(permissions: readonly Permission[]): Permission[] {
  const resolved = new Set<Permission>(permissions);
  for (const permission of permissions) {
    for (const required of PERMISSION_REQUIRES[permission] ?? []) resolved.add(required);
  }
  return [...resolved];
}
