export interface HardcoverSettings {
  tokenConfigured: boolean;
  enabled: boolean;
  autoSyncOnStatusChange: boolean;
  autoSyncOnProgressUpdate: boolean;
  autoSyncOnRatingChange: boolean;
  privacySettingId: number;
  lastSyncedAt: string | null;
}

export interface HardcoverAdminSettings {
  featureEnabled: boolean;
}

export interface UpsertHardcoverSettingsPayload {
  apiToken?: string;
  enabled?: boolean;
  autoSyncOnStatusChange?: boolean;
  autoSyncOnProgressUpdate?: boolean;
  autoSyncOnRatingChange?: boolean;
  privacySettingId?: number;
}

export interface HardcoverTokenValidationResult {
  valid: boolean;
  hardcoverUsername?: string;
}

export type HardcoverSyncRunStatus = "running" | "completed" | "failed" | "cancelled";

export interface HardcoverSyncPendingSummary {
  totalBooks: number;
  pendingBooks: number;
}

export interface HardcoverActiveSyncStatus {
  runId: number;
  syncedBooks: number;
  totalBooks: number;
  status: HardcoverSyncRunStatus;
}

export type HardcoverPrivacySetting = 1 | 2 | 3;
