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
}
