import type { BookSelectionPayload } from "./book-selection";
import type { DeliveryArtifactMetadata, ReadAloudDeliveryPreference } from "./delivery";

export interface EmailRecipient {
  id: number;
  userId: number;
  name: string;
  email: string;
  isDefault: boolean;
  deviceType: string | null;
  preferredFormat: string | null;
  defaultTemplateId: number | null;
  createdAt: string;
  readAloudDelivery?: ReadAloudDeliveryPreference;
  /** The newest send to this recipient; only the list endpoint fills it. */
  lastSend?: EmailRecipientLastSend | null;
}

export interface EmailRecipientLastSend {
  bookId: number | null;
  bookTitle: string | null;
  status: "pending" | "sent" | "failed";
  createdAt: string;
  /** With failureCode and errorMessage, tells a retry or an unconfirmed send from a plain failure. */
  attemptCount?: number;
  failureCode?: string | null;
  errorMessage?: string | null;
}

export interface EmailRecipientForm {
  name: string;
  email: string;
  deviceType: string | null;
  preferredFormat: string | null;
  defaultTemplateId: number | null;
  readAloudDelivery?: ReadAloudDeliveryPreference;
}

export interface EmailSendLogEntry {
  id: number;
  userId: number;
  bookId: number | null;
  bookFileId: number | null;
  providerId: number | null;
  templateId: number | null;
  toEmail: string;
  toName: string | null;
  subject: string | null;
  status: "pending" | "sent" | "failed";
  attemptCount: number;
  errorMessage: string | null;
  sentAt: string | null;
  createdAt: string;
  deliveryPolicy?: ReadAloudDeliveryPreference;
  sourceRevision?: string | null;
  actualVariant?: string | null;
  artifactId?: string | null;
  deviceType?: string | null;
  recipientId?: number | null;
  failureCode?: string | null;
  dispatchPhase?: string | null;
  deliveryMetadata?: DeliveryArtifactMetadata | null;
  /** When a pending send will be tried again; null once it has settled. */
  nextRetryAt?: string | null;
  /** The book's title at read time; null when the book has since been deleted. */
  bookTitle?: string | null;
  /** The book's authors at read time, comma separated; null when it has none or was deleted. */
  bookAuthors?: string | null;
  /** The file that went out, read through bookFileId. */
  fileFormat?: string | null;
  fileSizeBytes?: number | null;
}

/** GET /email/log/summary: counts across the caller's whole log. */
export interface EmailSendLogSummary {
  total: number;
  failed: number;
  pending: number;
}

/** Every provider route answers with the stored row minus its password. */
export interface EmailProvider {
  id: number;
  /** Null for a provider no account owns. */
  userId: number | null;
  name: string;
  host: string;
  port: number;
  username: string | null;
  fromName: string | null;
  fromAddress: string | null;
  auth: boolean;
  ssl: boolean;
  startTls: boolean;
  isDefault: boolean;
  isShared: boolean;
  isSystemProvider: boolean;
  tlsRejectUnauthorized: boolean;
  /** Set by the last connection test; absent from servers before 3.4.0. */
  lastTestedAt?: string | null;
  lastTestOk?: boolean | null;
  lastTestError?: string | null;
  createdAt: string;
  updatedAt: string;
  hasPassword: boolean;
}

/** POST /email/providers */
export interface EmailProviderCreateRequest {
  name: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  fromName?: string;
  fromAddress?: string;
  auth: boolean;
  ssl: boolean;
  startTls: boolean;
  tlsRejectUnauthorized: boolean;
}

/** PUT /email/providers/:id. An empty password removes the stored one. */
export type EmailProviderUpdateRequest = Partial<EmailProviderCreateRequest>;

/** POST /email/providers/:id/test and POST /email/recipients/:id/test. */
export interface EmailTestResult {
  success: boolean;
  error?: string;
}

/**
 * GET and PUT /email/preferences: the defaults sending uses, including any still carried by a
 * row's legacy isDefault flag. An account that never saved preferences gets only userId and the
 * three defaults.
 */
export interface EmailPreferences {
  id?: number;
  userId: number;
  defaultProviderId: number | null;
  defaultRecipientId: number | null;
  defaultTemplateId: number | null;
  createdAt?: string;
  updatedAt?: string;
}

/** PUT /email/preferences. An omitted default is left alone; null clears it. */
export interface EmailPreferencesUpdateRequest {
  defaultProviderId?: number | null;
  defaultRecipientId?: number | null;
  defaultTemplateId?: number | null;
}

export interface EmailTemplate {
  id: number;
  /** Null for a built-in template. */
  userId: number | null;
  name: string;
  subject: string;
  bodyText: string;
  isDefault: boolean;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

/** POST /email/templates */
export interface EmailTemplateCreateRequest {
  name: string;
  subject: string;
  bodyText: string;
}

/** PUT /email/templates/:id */
export type EmailTemplateUpdateRequest = Partial<EmailTemplateCreateRequest>;

/** POST /email/templates/:id/preview */
export interface EmailTemplatePreviewRequest {
  bookId: number;
}

/** POST /email/templates/preview: text from the editor, before it is saved. */
export interface EmailTemplateTextPreviewRequest {
  subject: string;
  bodyText: string;
  bookId: number;
}

/** POST /email/templates/:id/preview */
export interface EmailTemplatePreview {
  subject: string;
  bodyText: string;
}

/** The file a send of the previewed book would attach, named as the email names it. */
export interface EmailTemplatePreviewAttachment {
  fileName: string;
  format: string | null;
  sizeBytes: number | null;
}

/** POST /email/templates/preview */
export interface EmailTemplateTextPreview extends EmailTemplatePreview {
  /** Null when the book has no file a send could attach; absent from servers before 3.4.0. */
  attachment?: EmailTemplatePreviewAttachment | null;
}

/** PUT /email/recipient-groups/:id answers this, without the members. */
export interface EmailRecipientGroupSummary {
  id: number;
  userId: number;
  name: string;
  defaultTemplateId: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Every other recipient group route that answers with a group. */
export interface EmailRecipientGroup extends EmailRecipientGroupSummary {
  members: EmailRecipient[];
}

/** POST /email/recipient-groups */
export interface EmailRecipientGroupCreateRequest {
  name: string;
  defaultTemplateId?: number;
}

/** PUT /email/recipient-groups/:id */
export interface EmailRecipientGroupUpdateRequest {
  name?: string;
  defaultTemplateId?: number | null;
}

/** POST /email/recipient-groups/:id/members */
export interface EmailRecipientGroupMemberRequest {
  recipientId: number;
}

/** POST /email/recipients/:id/test, written in the sender's interface language. */
export interface EmailRecipientTestRequest {
  subject: string;
  text: string;
}

/** Who and how to send, beside the book selection of POST /email/send. */
export interface EmailSendOptions {
  recipientIds?: number[];
  groupIds?: number[];
  fileId?: number;
  providerId?: number;
  templateId?: number;
}

/** POST /email/send. It needs at least one recipient, given directly or through a group. */
export type EmailSendRequest = BookSelectionPayload & EmailSendOptions;

/** POST /email/send, POST /email/send/quick/:bookId and POST /email/log/:id/resend. */
export interface EmailSendAccepted {
  queued: number;
}

/** The query of GET /email/log; GET /email/admin/log reads only page and size. */
export interface EmailSendLogQuery {
  page?: number;
  size?: number;
  bookId?: number;
  status?: EmailSendLogEntry["status"];
  recipientId?: number;
}
