export enum LoginErrorCode {
  ACCOUNT_LOCKED = "account_locked",
  PASSWORD_AUTH_DISABLED = "password_auth_disabled",
}

export const AuthenticationMethod = {
  Password: "password",
  Oidc: "oidc",
  MagicLink: "magic_link",
  Setup: "setup",
  Legacy: "legacy",
} as const;

export type AuthenticationMethod = (typeof AuthenticationMethod)[keyof typeof AuthenticationMethod];

export enum OidcErrorCode {
  STATE_EXPIRED = "oidc_state_expired",
  PRIVATE_ISSUER_ADDRESS = "oidc_private_issuer_address",
  TLS_CERTIFICATE_UNTRUSTED = "oidc_tls_certificate_untrusted",
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
  sidebarConfig?: import("./sidebar").SidebarConfig;
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
  authenticationMethod?: AuthenticationMethod;
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

export interface LoginOptionsResponse {
  passwordLoginEnabled: boolean;
  allowRegistration: boolean;
  oidcProviders: OidcProviderPublic[];
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

export interface OidcCallbackResult extends AuthResponse {
  mode: "login";
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

export type AuthClientKind = "web" | "native";

export interface AuthClientOptions {
  clientKind?: AuthClientKind;
  deviceLabel?: string;
}

export interface NativeCredentials {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  sessionId: number;
}

export interface AuthResponse extends RefreshResponse {
  user: AuthUser;
}

export interface NativeAuthResponse extends NativeCredentials {
  user: AuthUser;
}

export interface RefreshResponse {
  accessToken: string;
  accessTokenExpiresAt: string;
  sessionId: number;
  refreshToken?: string;
  refreshTokenExpiresAt?: string;
}

export interface Session {
  id: number;
  clientKind: AuthClientKind;
  deviceLabel: string | null;
  authenticationMethod: AuthenticationMethod;
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
