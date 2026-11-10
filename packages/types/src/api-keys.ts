import { Permission, RESTRICTIVE_PERMISSIONS } from "./permissions";

/** Every token starts with this, so a key is told apart from a session token without parsing it. */
export const API_KEY_PREFIX = "bok_";

export const API_KEY_ACCESS_LEVELS = ["read", "write"] as const;
export type ApiKeyAccess = (typeof API_KEY_ACCESS_LEVELS)[number];

/**
 * Where a key may authenticate. Only `api` is issued today; the others are reserved so the stored
 * value never has to change shape when OPDS and KOReader accept keys.
 */
export const API_KEY_AUDIENCES = ["api", "opds", "koreader"] as const;
export type ApiKeyAudience = (typeof API_KEY_AUDIENCES)[number];

/** Lifetimes offered when a key is created, in days. `null` is a key that never expires. */
export const API_KEY_EXPIRY_PRESETS = [30, 90, 365, null] as const;
export type ApiKeyExpiryPreset = (typeof API_KEY_EXPIRY_PRESETS)[number];
export const API_KEY_DEFAULT_EXPIRY_DAYS = 90;

/**
 * Permissions a key can be granted. Restrictive ones are never granted: a key keeps every one its
 * owner holds. `ApiKeys` is left out because keys are only ever managed from a signed-in session.
 */
export const API_KEY_GRANTABLE_PERMISSIONS: readonly Permission[] = Object.values(Permission).filter(
  (permission) => permission !== Permission.ApiKeys && !RESTRICTIVE_PERMISSIONS.includes(permission),
);

export const API_KEY_MAX_ACTIVE_PER_USER = 25;
export const API_KEY_NAME_MAX_LENGTH = 100;
export const API_KEY_MAX_LIBRARIES = 500;

export interface ApiKeyUserRef {
  id: number;
  username: string;
}

export interface ApiKeySummary {
  id: number;
  name: string;
  /** The last characters of the token, shown as `bok_...a1b2` so a key can be recognised. */
  hint: string;
  audience: ApiKeyAudience;
  access: ApiKeyAccess;
  /** The permissions the key was granted. It can only ever use those its owner still holds. */
  permissions: string[];
  admin: boolean;
  /** The only libraries the key may reach, or null for every library its owner can see. */
  libraryIds: number[] | null;
  createdAt: string;
  /** The administrator who issued the key for its owner, or null when the owner created it. */
  createdBy: ApiKeyUserRef | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  revokedAt: string | null;
}

export interface CreateApiKeyRequest {
  name: string;
  /** One of `API_KEY_EXPIRY_PRESETS`. Omitted means the default lifetime. */
  expiresInDays?: number | null;
  /** Omitted means `read`. */
  access?: ApiKeyAccess;
  /** Omitted means none. */
  permissions?: string[];
  /** Administrator access. Only a superuser's key can carry it, and never with `libraryIds`. */
  admin?: boolean;
  /** Omitted or null means every library the owner can see. */
  libraryIds?: number[] | null;
}

/** The token is returned here and nowhere else: it is never shown again. */
export interface CreatedApiKey {
  key: ApiKeySummary;
  token: string;
}

export interface RenameApiKeyRequest {
  name: string;
}

export interface RevokeApiKeysResponse {
  revoked: number;
}

export interface ApiKeySettings {
  enabled: boolean;
  /** The longest lifetime a new key may have, in days, or null for no limit. */
  maxLifetimeDays: number | null;
}

export const API_KEY_ERROR_CODES = [
  "API_KEYS_DISABLED",
  "API_KEY_READ_ONLY",
  "API_KEY_ROUTE_FORBIDDEN",
  "API_KEY_LIMIT_REACHED",
  "API_KEY_SCOPE_EXCEEDS_OWNER",
  "API_KEY_EXPIRY_EXCEEDS_CAP",
  "API_KEY_ADMIN_WITH_LIBRARIES",
  "API_KEY_OWNER_NOT_PERMITTED",
] as const;
export type ApiKeyErrorCode = (typeof API_KEY_ERROR_CODES)[number];
