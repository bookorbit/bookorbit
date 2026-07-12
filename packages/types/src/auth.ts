export enum OidcErrorCode {
  STATE_EXPIRED = "oidc_state_expired",
  TOKEN_EXCHANGE_FAILED = "oidc_token_exchange_failed",
  USER_NOT_PROVISIONED = "oidc_user_not_provisioned",
  USER_INACTIVE = "oidc_user_inactive",
  PROVIDER_ERROR = "oidc_provider_error",
}

export const ProvisioningMethod = {
  Local: "local",
  Manual: "manual",
  Oidc: "oidc",
  Shared: "shared",
} as const;

export type ProvisioningMethod = (typeof ProvisioningMethod)[keyof typeof ProvisioningMethod];

export interface UserSettings {
  syncReaderPreferences?: boolean;
  syncThemePreferences?: boolean;
  statisticsConfig?: import("./statistics").StatisticsSettings;
  onboarding?: {
    tourCompleted?: boolean;
  };
  notificationPreferences?: import("./notification").NotificationPreferences;
  seriesCollapsePreferences?: import("./series-collapse").SeriesCollapsePreferences;
  dashboardConfig?: import("./dashboard").DashboardConfig;
  achievementPreferences?: {
    enabled?: boolean;
  };
  timezone?: string;
}

export interface AuthUser {
  id: number;
  username: string;
  name: string;
  email?: string;
  active: boolean;
  isSuperuser: boolean;
  isDefaultPassword: boolean;
  settings: UserSettings;
  avatarUrl?: string | null;
  provisioningMethod: ProvisioningMethod;
  permissions: string[];
}

export interface OidcPublicConfig {
  enabled: boolean;
  providerName: string;
  issuerUri: string;
  clientId: string;
  scopes: string;
  iconUrl?: string;
}

export interface OidcProviderPublic {
  slug: string;
  displayName: string;
  enabled: boolean;
  iconUrl?: string | null;
  clientId: string;
  scopes: string;
}

export interface OidcProviderConfig {
  id: number;
  slug: string;
  displayName: string;
  enabled: boolean;
  issuerUri: string;
  clientId: string;
  clientSecret?: string;
  scopes: string;
  iconUrl?: string | null;
  claimMapping: OidcClaimMapping;
  autoProvision: OidcAutoProvision;
  displayOrder: number;
}

export interface OidcLinkedIdentity {
  id: number;
  providerId: number;
  providerSlug: string;
  providerName: string;
  providerIconUrl?: string | null;
  oidcSubject: string;
  oidcIssuer: string;
  linkedAt: string;
}

export interface OidcClaimMapping {
  username: string;
  name: string;
  email: string;
  groups: string;
}

export interface OidcAutoProvision {
  enabled: boolean;
  allowLocalLinking: boolean;
  defaultPermissionNames: string[];
}

export interface OidcBaseConfig {
  enabled: boolean;
  providerName: string;
  issuerUri: string;
  clientId: string;
  scopes: string;
  iconUrl?: string;
  claimMapping: OidcClaimMapping;
  autoProvision: OidcAutoProvision;
}

export interface OidcCallbackResult {
  mode: "login";
  accessToken: string;
  user: AuthUser;
}

export interface OidcLinkResult {
  mode: "link";
  linked: true;
}

export interface OidcPreviewResult {
  mode: "preview";
  claims: {
    raw: Record<string, unknown>;
    mapped: { username: string; name: string; email?: string; groups: string[] };
  };
}

export type OidcCallbackResponse = OidcCallbackResult | OidcLinkResult | OidcPreviewResult;

export interface AuthResponse {
  accessToken: string;
  user: AuthUser;
}

export interface RefreshResponse {
  accessToken: string;
}

export interface Session {
  id: number;
  createdAt: string;
  expiresAt: string;
}

export interface MagicLinkToken {
  id: number;
  userId: number;
  username: string;
  createdByUsername: string | null;
  label: string;
  rawToken: string;
  isActive: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  useCount: number;
  createdAt: string;
  revokedAt: string | null;
}

export interface MagicLinkTokenCreateResponse {
  id: number;
  token: string;
  label: string;
  expiresAt: string | null;
}
