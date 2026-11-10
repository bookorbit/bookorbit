import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { AuthenticationMethod, Permission, RESTRICTIVE_PERMISSIONS, type ApiKeyAccess, type ApiKeyErrorCode } from '@bookorbit/types';

import { PermissionService } from '../../common/services/permission.service';
import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { AuthService } from '../auth/auth.service';
import { ApiKeyFailureLimiter } from './api-key-failure-limiter';
import { hasValidApiKeyChecksum, hashApiKeyToken } from './api-key-token';
import { ApiKeyRepository, type ApiKeyRecord } from './api-key.repository';

const KNOWN_PERMISSIONS = new Set<string>(Object.values(Permission));
const ALL_GRANTS: readonly Permission[] = Object.values(Permission).filter((permission) => !RESTRICTIVE_PERMISSIONS.includes(permission));

type RefusalReason = 'malformed' | 'disabled' | 'unknown' | 'revoked' | 'expired' | 'audience' | 'owner_inactive' | 'owner_not_permitted';

class ApiKeyRefusal extends UnauthorizedException {
  constructor(
    readonly reason: RefusalReason,
    readonly keyId: number | null,
    errorCode?: ApiKeyErrorCode,
  ) {
    super(errorCode ? { message: 'API keys are turned off on this server', errorCode } : 'Invalid API key');
  }
}

/**
 * The owner as the key may act: their permissions cut down to the key's grant, administrator power
 * only when the key carries it, and their restrictions kept whatever the grant says. Recomputed on
 * every request, so demoting or restricting the owner shrinks their keys at once.
 */
export function narrowToApiKey(owner: RequestUser, key: ApiKeyRecord): RequestUser {
  const ownerGrants: readonly string[] = owner.isSuperuser ? ALL_GRANTS : owner.permissions;
  const granted = key.permissions.filter(
    (permission) =>
      KNOWN_PERMISSIONS.has(permission) && !RESTRICTIVE_PERMISSIONS.includes(permission as Permission) && ownerGrants.includes(permission),
  ) as Permission[];
  const restrictions = owner.permissions.filter((permission) => RESTRICTIVE_PERMISSIONS.includes(permission));
  return {
    ...owner,
    sessionId: undefined,
    isSuperuser: owner.isSuperuser && key.admin,
    isDefaultPassword: false,
    authenticationMethod: AuthenticationMethod.ApiKey,
    permissions: [...new Set([...granted, ...restrictions])],
    credential: {
      kind: 'api_key',
      keyId: key.id,
      keyName: key.name,
      audience: 'api',
      access: key.access as ApiKeyAccess,
      libraryIds: key.libraryLimited ? key.libraryIds : null,
      ownerIsSuperuser: owner.isSuperuser,
    },
  };
}

@Injectable()
export class ApiKeyAuthenticator {
  private readonly logger = new Logger(ApiKeyAuthenticator.name);

  constructor(
    private readonly repo: ApiKeyRepository,
    private readonly appSettings: AppSettingsService,
    private readonly authService: AuthService,
    private readonly permissions: PermissionService,
    private readonly limiter: ApiKeyFailureLimiter,
  ) {}

  async authenticate(token: string, address: string | null): Promise<RequestUser> {
    this.limiter.assertNotBlocked(address);
    try {
      return await this.verify(token, address);
    } catch (err) {
      if (err instanceof ApiKeyRefusal) {
        this.limiter.recordFailure(address);
        this.logger.warn(
          `[api-key.auth] [fail] keyId=${err.keyId ?? 'none'} reason=${err.reason} ip="${sanitizeLogValue(address ?? 'unknown')}" - API key refused`,
        );
      }
      throw err;
    }
  }

  private async verify(token: string, address: string | null): Promise<RequestUser> {
    if (!hasValidApiKeyChecksum(token)) throw new ApiKeyRefusal('malformed', null);

    const settings = await this.appSettings.getApiKeySettings();
    if (!settings.enabled) throw new ApiKeyRefusal('disabled', null, 'API_KEYS_DISABLED');

    const key = await this.repo.findByHash(hashApiKeyToken(token));
    if (!key) throw new ApiKeyRefusal('unknown', null);
    if (key.revokedAt) throw new ApiKeyRefusal('revoked', key.id);
    if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) throw new ApiKeyRefusal('expired', key.id);
    if (key.audience !== 'api') throw new ApiKeyRefusal('audience', key.id);

    const owner = await this.authService.findActingUser(key.userId);
    if (!owner) throw new ApiKeyRefusal('owner_inactive', key.id);
    if (!this.permissions.userHas(owner, Permission.ApiKeys)) throw new ApiKeyRefusal('owner_not_permitted', key.id);

    this.repo.touchLastUsed(key.id, address).catch((err: unknown) => {
      const errorClass = err instanceof Error ? err.constructor.name : 'Error';
      const error = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[api-key.touch] [fail] keyId=${key.id} errorClass=${errorClass} error="${sanitizeLogValue(error)}" - last use not recorded`);
    });

    return narrowToApiKey(owner, key);
  }
}
