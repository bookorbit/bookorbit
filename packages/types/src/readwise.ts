export type ReadwiseSyncDisabledReason = "permission_denied" | "missing_token" | "user_disabled" | "invalid_token";

export interface ReadwiseSettings {
  tokenConfigured: boolean;
  enabled: boolean;
  effectiveEnabled: boolean;
  disabledReason: ReadwiseSyncDisabledReason | null;
  lastSyncedAt: string | null;
}

export interface UpsertReadwiseSettingsPayload {
  apiToken?: string;
  enabled?: boolean;
}

export interface ReadwiseTokenValidationResult {
  valid: boolean;
  message?: string;
}
