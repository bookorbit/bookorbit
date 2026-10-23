export enum AuditAction {
  AuthRegister = "auth.register",
  AuthLogin = "auth.login",
  AuthLoginFailed = "auth.login.failed",
  AuthLogout = "auth.logout",
  AuthPasswordChange = "auth.password.change",
  AuthPasswordResetRequest = "auth.password.reset_request",
  AuthPasswordReset = "auth.password.reset",
  AuthPasswordAdminReset = "auth.password.admin_reset",
  AuthSessionRevoke = "auth.session.revoke",

  MagicLinkCreate = "magic_link.create",
  MagicLinkLogin = "magic_link.login",
  MagicLinkRevoke = "magic_link.revoke",
  MagicLinkActivate = "magic_link.activate",
  MagicLinkDeactivate = "magic_link.deactivate",

  OidcLogin = "auth.oidc.login",
  OidcUserProvisioned = "auth.oidc.user_provisioned",
  OidcIdentityLinked = "auth.oidc.identity_linked",
  OidcIdentityUnlinked = "auth.oidc.identity_unlinked",

  UserCreate = "user.create",
  UserUpdate = "user.update",
  UserSelfUpdate = "user.self_update",
  UserDelete = "user.delete",
  UserPermissionSet = "user.permission.set",
  UserSuperuserEnable = "user.superuser.enable",
  UserSuperuserDisable = "user.superuser.disable",
  UserContentFiltersSet = "user.content_filters.set",
  UserUnlock = "user.unlock",
  ReadingInsightsSharingUpdate = "reading_insights.sharing.update",
  ReadingInsightsProfileView = "reading_insights.profile.view",

  LibraryCreate = "library.create",
  LibraryUpdate = "library.update",
  LibraryDelete = "library.delete",
  LibraryFolderAdd = "library.folder.add",
  LibraryFolderRemove = "library.folder.remove",
  LibraryAccessGrant = "library.access.grant",
  LibraryAccessUpdate = "library.access.update",
  LibraryAccessRevoke = "library.access.revoke",
  LibraryWriteMetadataToFiles = "library.write_metadata_to_files",
  LibraryBulkRename = "library.bulk_rename",
  LibraryRecomputeAddedAt = "library.recompute_added_at",

  PodcastCreate = "podcast.create",
  PodcastUpdate = "podcast.update",
  PodcastArchive = "podcast.archive",
  PodcastRestore = "podcast.restore",
  PodcastPurge = "podcast.purge",
  PodcastMerge = "podcast.merge",
  PodcastDownload = "podcast.download",
  PodcastDownloadRemove = "podcast.download.remove",
  PodcastRetentionUpdate = "podcast.retention.update",
  PodcastOpmlImport = "podcast.opml.import",
  PodcastOpmlExport = "podcast.opml.export",

  BookUpload = "book.upload",
  BookMetadataUpdate = "book.metadata.update",
  BookMetadataLocksUpdate = "book.metadata.locks.update",
  BookDelete = "book.delete",
  BookBulkMetadataRefresh = "book.bulk.metadata_refresh",
  BookBulkDelete = "book.bulk.delete",
  BookBulkCoverReextract = "book.bulk.cover_reextract",
  BookBulkSetStatus = "book.bulk.set_status",
  BookBulkSetRating = "book.bulk.set_rating",
  BookBulkSetMetadata = "book.bulk.set_metadata",
  BookBulkUpdateTags = "book.bulk.update_tags",
  BookBulkSetMetadataLock = "book.bulk.set_metadata_lock",
  BookBulkEditMetadata = "book.bulk.edit_metadata",
  BookBulkMoveLibrary = "book.bulk.move_library",
  BookReadingStateReset = "book.reading_state.reset",

  BookWriteAndRename = "book.write_and_rename",

  CollectionCreate = "collection.create",
  CollectionUpdate = "collection.update",
  CollectionDelete = "collection.delete",
  CollectionBooksAdd = "collection.books.add",
  CollectionBooksRemove = "collection.books.remove",

  SmartScopeCreate = "smart_scope.create",
  SmartScopeUpdate = "smart_scope.update",
  SmartScopeDelete = "smart_scope.delete",

  BookDockFinalize = "book_dock.finalize",

  BookRequestCreate = "book_request.create",
  BookRequestApprove = "book_request.approve",
  BookRequestReject = "book_request.reject",
  BookRequestCancel = "book_request.cancel",
  BookRequestFulfill = "book_request.fulfill",
  BookRequestGrab = "book_request.grab",
  BookRequestImport = "book_request.import",
  BookRequestRemoveDownload = "book_request.remove_download",
  BookRequestDelete = "book_request.delete",

  DownloadClientCreate = "download_client.create",
  DownloadClientUpdate = "download_client.update",
  DownloadClientDelete = "download_client.delete",

  RequestIndexerCreate = "request_indexer.create",
  RequestIndexerUpdate = "request_indexer.update",
  RequestIndexerDelete = "request_indexer.delete",
  RequestIndexerPluginInspect = "request_indexer.plugin.inspect",
  RequestIndexerPluginInstall = "request_indexer.plugin.install",
  RequestIndexerPluginRemove = "request_indexer.plugin.remove",

  AuthorUpdate = "author.update",
  AuthorDelete = "author.delete",
  AuthorMerge = "author.merge",
  AuthorEnrichmentConfigUpdate = "author.enrichment.config_update",
  AuthorEnrichmentPause = "author.enrichment.pause",
  AuthorEnrichmentResume = "author.enrichment.resume",
  AuthorEnrichmentCancel = "author.enrichment.cancel",

  EntityManagerMerge = "entity_manager.merge",
  EntityManagerRename = "entity_manager.rename",
  EntityManagerDelete = "entity_manager.delete",
  EntityManagerSplit = "entity_manager.split",
  EntityManagerDismiss = "entity_manager.dismiss",
  EntityManagerUndismiss = "entity_manager.undismiss",

  AppSettingsUpdate = "app_settings.update",

  KoboDeviceRegister = "kobo.device.register",
  KoboDeviceRename = "kobo.device.rename",
  KoboDeviceRemove = "kobo.device.remove",

  EmailProviderCreate = "email.provider.create",
  EmailProviderUpdate = "email.provider.update",
  EmailProviderDelete = "email.provider.delete",
  EmailProviderSetDefault = "email.provider.set_default",
  EmailProviderSetSystem = "email.provider.set_system",
  EmailProviderClearSystem = "email.provider.clear_system",

  EmailTemplateCreate = "email.template.create",
  EmailTemplateUpdate = "email.template.update",
  EmailTemplateDelete = "email.template.delete",
  EmailTemplateSetDefault = "email.template.set_default",

  EmailRecipientCreate = "email.recipient.create",
  EmailRecipientUpdate = "email.recipient.update",
  EmailRecipientDelete = "email.recipient.delete",

  EmailRecipientGroupCreate = "email.recipient_group.create",
  EmailRecipientGroupUpdate = "email.recipient_group.update",
  EmailRecipientGroupDelete = "email.recipient_group.delete",
  EmailRecipientGroupMemberAdd = "email.recipient_group.member_add",
  EmailRecipientGroupMemberRemove = "email.recipient_group.member_remove",

  MaintenanceMissingBooksClean = "maintenance.missing_books.clean",
  MaintenanceBrokenCoversClean = "maintenance.broken_covers.clean",
  MaintenanceOrphanedCoversClean = "maintenance.orphaned_covers.clean",
}

export enum AuditResource {
  User = "user",
  Library = "library",
  Book = "book",
  Podcast = "podcast",
  PodcastEpisode = "podcast_episode",
  Collection = "collection",
  SmartScope = "smart_scope",
  BookDockFile = "book_dock_file",
  BookRequest = "book_request",
  DownloadClient = "download_client",
  RequestIndexer = "request_indexer",
  Author = "author",
  AppSettings = "app_settings",
  Genre = "genre",
  Tag = "tag",
  KoboDevice = "kobo_device",
  EmailProvider = "email_provider",
  EmailTemplate = "email_template",
  EmailRecipient = "email_recipient",
  EmailRecipientGroup = "email_recipient_group",
  Narrator = "narrator",
  Publisher = "publisher",
  Language = "language",
  Series = "series",
  OidcIdentity = "oidc_identity",
  MagicLinkToken = "magic_link_token",
  ReadingInsightsProfile = "reading_insights_profile",
}

export interface AuditLogEntry {
  id: number;
  userId: number | null;
  actorUsername: string;
  action: string;
  resource: string | null;
  resourceId: number | null;
  description: string;
  ip: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
  /** The person's display name while their account exists. */
  actorName?: string | null;
  /** Name of the target: its current name, or the last one the log saw if it is gone. Null when unknown. */
  targetLabel?: string | null;
  /** Whether the target still exists. Null when the target type has nothing to look up. */
  targetExists?: boolean | null;
}

export interface BookDeletionAuditBook {
  id: number;
  title: string | null;
}

export interface BookDeletionAuditMeta {
  total: number;
  books: BookDeletionAuditBook[];
  omitted: number;
}

export interface AuditActorOption {
  userId: number | null;
  username: string;
  /** Display name while the account exists. */
  name?: string | null;
}

export interface AuditLogPage {
  data: AuditLogEntry[];
  total: number;
}

/**
 * Display groups for audit events. `other` catches actions this build does not know yet, so an
 * older client or a newer server never fails to place a row.
 */
export const AUDIT_CATEGORIES = ["access", "users", "libraries", "books", "requests", "collections", "devices", "settings", "other"] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

/** Action prefixes per category. The server filters with these and the client labels with them. */
export const AUDIT_CATEGORY_PREFIXES: Record<Exclude<AuditCategory, "other">, readonly string[]> = {
  access: ["auth.", "magic_link."],
  users: ["user.", "reading_insights."],
  libraries: ["library.", "podcast."],
  books: ["book.", "book_dock."],
  requests: ["book_request.", "download_client.", "request_indexer."],
  collections: ["collection.", "smart_scope."],
  devices: ["kobo.", "email."],
  settings: ["app_settings.", "entity_manager.", "author.", "maintenance."],
};

export function getAuditCategory(action: string): AuditCategory {
  for (const [category, prefixes] of Object.entries(AUDIT_CATEGORY_PREFIXES)) {
    if (prefixes.some((prefix) => action.startsWith(prefix))) return category as AuditCategory;
  }
  return "other";
}

/** Routine sign-in traffic: left out of the Changes view and folded in the Sign-ins view. */
export const AUDIT_SIGN_IN_ACTIONS: readonly AuditAction[] = [
  AuditAction.AuthLogin,
  AuditAction.AuthLogout,
  AuditAction.AuthLoginFailed,
  AuditAction.OidcLogin,
  AuditAction.MagicLinkLogin,
];

/** Security groups shown as chips in the Security view. Their union is the Security view. */
export const AUDIT_SECURITY_GROUPS = {
  failed: [AuditAction.AuthLoginFailed],
  accounts: [
    AuditAction.AuthRegister,
    AuditAction.UserCreate,
    AuditAction.UserUpdate,
    AuditAction.UserDelete,
    AuditAction.UserUnlock,
    AuditAction.OidcUserProvisioned,
  ],
  passwords: [AuditAction.AuthPasswordChange, AuditAction.AuthPasswordResetRequest, AuditAction.AuthPasswordReset, AuditAction.AuthPasswordAdminReset],
  permissions: [AuditAction.UserPermissionSet, AuditAction.UserSuperuserEnable, AuditAction.UserSuperuserDisable],
  access: [
    AuditAction.UserContentFiltersSet,
    AuditAction.LibraryAccessGrant,
    AuditAction.LibraryAccessUpdate,
    AuditAction.LibraryAccessRevoke,
    AuditAction.ReadingInsightsSharingUpdate,
  ],
  links: [
    AuditAction.AuthSessionRevoke,
    AuditAction.MagicLinkCreate,
    AuditAction.MagicLinkRevoke,
    AuditAction.MagicLinkActivate,
    AuditAction.MagicLinkDeactivate,
    AuditAction.OidcIdentityLinked,
    AuditAction.OidcIdentityUnlinked,
  ],
} as const satisfies Record<string, readonly AuditAction[]>;
export type AuditSecurityGroup = keyof typeof AUDIT_SECURITY_GROUPS;
export const AUDIT_SECURITY_GROUP_KEYS = Object.keys(AUDIT_SECURITY_GROUPS) as AuditSecurityGroup[];
export const AUDIT_SECURITY_ACTIONS: readonly AuditAction[] = Object.values(AUDIT_SECURITY_GROUPS).flat();

/** `changes` is everything except sign-in traffic. Omitting the kind keeps the original unfiltered list. */
export const AUDIT_LOG_KINDS = ["changes", "signins", "security"] as const;
export type AuditLogKind = (typeof AUDIT_LOG_KINDS)[number];

export interface AuditLogSummary {
  /** Events matching the filters, per view. `all` ignores the view. */
  kinds: Record<AuditLogKind | "all", number>;
  /** Per category, within the requested view. */
  categories: Partial<Record<AuditCategory, number>>;
  /** Per security group, within the filters. */
  securityGroups: Record<AuditSecurityGroup, number>;
  retentionDays: number;
  oldestAt: string | null;
}

/** Sign-in traffic folded per person, local day and address. */
export interface AuditSignInGroup {
  day: string;
  actorUsername: string;
  actorName: string | null;
  userId: number | null;
  ip: string | null;
  signIns: number;
  signOuts: number;
  failed: number;
  failedUsernames: string[];
  firstAt: string;
  lastAt: string;
}

export interface AuditSignInPage {
  data: AuditSignInGroup[];
  total: number;
}
