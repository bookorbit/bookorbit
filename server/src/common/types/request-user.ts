import { Permission } from '@bookorbit/types';
import type { AuthenticationMethod } from '@bookorbit/types';
import type { ContentFilterRules } from '@bookorbit/types';

export interface SessionCredential {
  kind: 'session';
  sessionId: number;
}

/**
 * A request made with an API key. The `RequestUser` it travels on is already narrowed: its
 * `permissions` and `isSuperuser` are what the key may use, not what its owner holds.
 */
export interface ApiKeyCredential {
  kind: 'api_key';
  keyId: number;
  keyName: string;
  audience: 'api';
  access: 'read' | 'write';
  /** The only libraries the key may reach, or null for every library its owner can see. */
  libraryIds: readonly number[] | null;
  /**
   * The owner's own superuser flag. Library visibility follows it, because a superuser's key without
   * administrator access is no longer `isSuperuser` yet must still see every library.
   */
  ownerIsSuperuser: boolean;
}

export type RequestCredential = SessionCredential | ApiKeyCredential;

export interface RequestUser {
  id: number;
  username: string;
  name: string;
  email: string | null;
  active: boolean;
  isSuperuser: boolean;
  isDefaultPassword: boolean;
  tokenVersion: number;
  sessionId?: number;
  settings: Record<string, unknown>;
  avatarUrl: string | null;
  avatarSource?: 'none' | 'external' | 'uploaded' | null;
  avatarVersion?: number | null;
  provisioningMethod: string;
  authenticationMethod?: AuthenticationMethod;
  permissions: Permission[];
  contentFilters: ContentFilterRules;
  /** How the request authenticated. Absent for users loaded outside a request. */
  credential?: RequestCredential;
}

export function apiKeyCredentialOf(user: Pick<RequestUser, 'credential'> | null | undefined): ApiKeyCredential | null {
  return user?.credential?.kind === 'api_key' ? user.credential : null;
}

/**
 * Per-user caches are keyed by user id, but an API key can see and do less than its owner. A result
 * cached for one must never be served to the other, so every such cache key carries the key's scope.
 */
export function principalCacheKey(
  user: Pick<RequestUser, 'isSuperuser' | 'credential'> & Partial<Pick<RequestUser, 'permissions'>>,
  key: string,
): string {
  const credential = apiKeyCredentialOf(user);
  if (!credential) return key;
  const libraries = credential.libraryIds ? [...credential.libraryIds].sort((a, b) => a - b).join(',') : '*';
  const permissions = [...(user.permissions ?? [])].sort().join(',');
  const owner = credential.ownerIsSuperuser ? 'superuser' : 'user';
  const admin = user.isSuperuser ? 'admin' : 'scoped';
  return `${key}|api-key:${owner}:${admin}:${credential.access}:${libraries}:${permissions}`;
}
