export interface UserSettings {
  syncReaderPreferences?: boolean;
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
  provisioningMethod: "local" | "oidc";
  permissions: string[];
}

export interface OidcPublicConfig {
  enabled: boolean;
  providerName: string;
  issuerUri: string;
  clientId: string;
  scopes: string;
}

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
