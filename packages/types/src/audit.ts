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
}

export enum AuditResource {
  User = "user",
  Library = "library",
  Book = "book",
  Collection = "collection",
  SmartScope = "smart_scope",
  BookDockFile = "book_dock_file",
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
}

export interface AuditLogPage {
  data: AuditLogEntry[];
  total: number;
}
