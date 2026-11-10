import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  API_KEY_DEFAULT_EXPIRY_DAYS,
  API_KEY_GRANTABLE_PERMISSIONS,
  API_KEY_MAX_ACTIVE_PER_USER,
  Permission,
  type ApiKeyAccess,
  type ApiKeyAudience,
  type ApiKeyErrorCode,
  type ApiKeySettings,
  type ApiKeySummary,
  type CreatedApiKey,
  type CreateApiKeyRequest,
} from '@bookorbit/types';

import { LibraryScopeService } from '../../common/library-scope/library-scope.service';
import { PermissionService } from '../../common/services/permission.service';
import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { AuthService } from '../auth/auth.service';
import { UserService } from '../user/user.service';
import { apiKeyHint, generateApiKeyToken, hashApiKeyToken } from './api-key-token';
import { ApiKeyRepository, type ApiKeyRecord, type NewApiKey } from './api-key.repository';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Revoked keys stay listed this long, and are deleted once revoked or expired for this long (C13). */
export const API_KEY_RETENTION_DAYS = 90;
const LIST_LIMIT = 200;
const PRUNE_BATCH_SIZE = 500;
const PRUNE_MAX_BATCHES = 100;
const GRANTABLE = new Set<string>(API_KEY_GRANTABLE_PERMISSIONS);
const KNOWN_PERMISSIONS = new Set<string>(Object.values(Permission));

interface ResolvedGrant {
  access: ApiKeyAccess;
  permissions: string[];
  admin: boolean;
  libraryIds: number[] | null;
  expiresAt: Date | null;
}

function refuse(errorCode: ApiKeyErrorCode, message: string): never {
  throw new BadRequestException({ message, errorCode });
}

export function toApiKeySummary(record: ApiKeyRecord): ApiKeySummary {
  return {
    id: record.id,
    name: record.name,
    hint: record.tokenHint,
    audience: record.audience as ApiKeyAudience,
    access: record.access as ApiKeyAccess,
    permissions: record.permissions.filter((permission) => KNOWN_PERMISSIONS.has(permission)),
    admin: record.admin,
    libraryIds: record.libraryLimited ? record.libraryIds : null,
    createdAt: record.createdAt.toISOString(),
    createdBy: record.createdBy !== null && record.createdByUsername !== null ? { id: record.createdBy, username: record.createdByUsername } : null,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
    lastUsedIp: record.lastUsedIp,
    revokedAt: record.revokedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);

  constructor(
    private readonly repo: ApiKeyRepository,
    private readonly appSettings: AppSettingsService,
    private readonly authService: AuthService,
    private readonly libraryScope: LibraryScopeService,
    private readonly permissions: PermissionService,
    private readonly users: UserService,
  ) {}

  getSettings(): Promise<ApiKeySettings> {
    return this.appSettings.getApiKeySettings();
  }

  async list(ownerId: number): Promise<ApiKeySummary[]> {
    const rows = await this.repo.listByUser(ownerId, new Date(Date.now() - API_KEY_RETENTION_DAYS * DAY_MS), LIST_LIMIT);
    return rows.map(toApiKeySummary);
  }

  /** `issuedBy` is the administrator issuing the key for its owner; omitted when the owner creates it. */
  async create(ownerId: number, input: CreateApiKeyRequest, issuedBy?: RequestUser): Promise<CreatedApiKey> {
    const settings = await this.assertEnabled();
    const owner = await this.loadOwner(ownerId);
    const grant = await this.resolveGrant(owner, input, settings);
    const created = await this.insert(owner.id, input.name.trim(), grant, issuedBy?.id ?? null);
    this.logger.log(
      `[api-key.create] [end] userId=${owner.id} keyId=${created.key.id} issuedBy=${issuedBy?.id ?? 'self'} access=${grant.access} admin=${grant.admin} libraryLimited=${grant.libraryIds !== null} - API key created`,
    );
    return created;
  }

  async rename(ownerId: number, keyId: number, name: string): Promise<ApiKeySummary> {
    await this.findLiveOwned(ownerId, keyId);
    if (!(await this.repo.rename(ownerId, keyId, name.trim()))) throw new NotFoundException('API key not found');
    return toApiKeySummary((await this.repo.findOwned(ownerId, keyId))!);
  }

  /**
   * A new secret for an existing key: the old token stops working the moment the new one is issued.
   * The grant is copied as it is; the lifetime restarts and is clamped to the current limit.
   */
  async regenerate(ownerId: number, keyId: number): Promise<CreatedApiKey> {
    const settings = await this.assertEnabled();
    const owner = await this.loadOwner(ownerId);
    const current = await this.findLiveOwned(ownerId, keyId);
    const lifetimeDays = current.expiresAt ? Math.max(1, Math.round((current.expiresAt.getTime() - current.createdAt.getTime()) / DAY_MS)) : null;
    const cappedDays =
      settings.maxLifetimeDays === null ? lifetimeDays : Math.min(lifetimeDays ?? settings.maxLifetimeDays, settings.maxLifetimeDays);
    const grant: ResolvedGrant = {
      access: current.access as ApiKeyAccess,
      permissions: current.permissions,
      admin: current.admin && owner.isSuperuser,
      libraryIds: current.libraryLimited ? current.libraryIds : null,
      expiresAt: cappedDays === null ? null : new Date(Date.now() + cappedDays * DAY_MS),
    };
    const created = await this.insert(owner.id, current.name, grant, current.createdBy, current.id);
    this.logger.log(`[api-key.regenerate] [end] userId=${owner.id} oldKeyId=${current.id} keyId=${created.key.id} - API key regenerated`);
    return created;
  }

  async revoke(ownerId: number, keyId: number): Promise<ApiKeyRecord> {
    const key = await this.repo.findOwned(ownerId, keyId);
    if (!key) throw new NotFoundException('API key not found');
    if (!key.revokedAt) await this.repo.revoke(ownerId, keyId);
    return key;
  }

  async revokeAll(ownerId: number): Promise<{ revoked: number }> {
    const revoked = await this.repo.revokeAllByUser(ownerId);
    this.logger.log(`[api-key.revoke_all] [end] userId=${ownerId} revoked=${revoked} - API keys revoked`);
    return { revoked };
  }

  /**
   * An administrator may manage another user's keys only when they could manage that user: a
   * manager who is not a superuser cannot touch a superuser's keys (C11).
   */
  async assertCanManageKeysOf(actor: RequestUser, targetUserId: number): Promise<RequestUser> {
    // Any account, suspended included: revoking a suspended person's keys is the point of looking.
    const target = await this.users.findByIdWithPermissions(targetUserId);
    if (!target) throw new NotFoundException('User not found');
    if (target.isSuperuser && !actor.isSuperuser) {
      throw new ForbiddenException("Only administrators can manage an administrator's API keys");
    }
    return target;
  }

  /** Deletes keys revoked or expired more than the retention period ago, in bounded batches. */
  async pruneStale(): Promise<number> {
    const cutoff = new Date(Date.now() - API_KEY_RETENTION_DAYS * DAY_MS);
    let deleted = 0;
    for (let batch = 0; batch < PRUNE_MAX_BATCHES; batch++) {
      const removed = await this.repo.pruneBatch(cutoff, PRUNE_BATCH_SIZE);
      deleted += removed;
      if (removed < PRUNE_BATCH_SIZE) break;
    }
    return deleted;
  }

  private async assertEnabled(): Promise<ApiKeySettings> {
    const settings = await this.appSettings.getApiKeySettings();
    if (!settings.enabled) throw new ForbiddenException({ message: 'API keys are turned off on this server', errorCode: 'API_KEYS_DISABLED' });
    return settings;
  }

  private async loadOwner(ownerId: number): Promise<RequestUser> {
    const owner = await this.authService.findActingUser(ownerId);
    if (!owner || !this.permissions.userHas(owner, Permission.ApiKeys)) {
      throw new BadRequestException({ message: 'This user is not allowed to have API keys', errorCode: 'API_KEY_OWNER_NOT_PERMITTED' });
    }
    return owner;
  }

  private async findLiveOwned(ownerId: number, keyId: number): Promise<ApiKeyRecord> {
    const key = await this.repo.findOwned(ownerId, keyId);
    if (!key) throw new NotFoundException('API key not found');
    if (key.revokedAt) throw new ConflictException('API key has been revoked');
    return key;
  }

  private async resolveGrant(owner: RequestUser, input: CreateApiKeyRequest, settings: ApiKeySettings): Promise<ResolvedGrant> {
    const admin = input.admin === true;
    const libraryIds = input.libraryIds?.length ? [...new Set(input.libraryIds)] : null;
    if (input.libraryIds && input.libraryIds.length === 0) {
      refuse('API_KEY_SCOPE_EXCEEDS_OWNER', 'Choose at least one library, or leave libraries empty for every library');
    }
    if (admin && !owner.isSuperuser) refuse('API_KEY_SCOPE_EXCEEDS_OWNER', "Only an administrator's key can have administrator access");
    if (admin && libraryIds) refuse('API_KEY_ADMIN_WITH_LIBRARIES', 'A key with administrator access cannot be limited to libraries');

    const permissions = [...new Set(input.permissions ?? [])];
    const notGrantable = permissions.filter((permission) => !GRANTABLE.has(permission));
    if (notGrantable.length) refuse('API_KEY_SCOPE_EXCEEDS_OWNER', `These permissions cannot be granted to a key: ${notGrantable.join(', ')}`);
    if (!owner.isSuperuser) {
      const missing = permissions.filter((permission) => !owner.permissions.includes(permission as Permission));
      if (missing.length) refuse('API_KEY_SCOPE_EXCEEDS_OWNER', `The owner does not hold: ${missing.join(', ')}`);
    }

    if (libraryIds) {
      const visible = new Set(await this.libraryScope.visibleIds(owner));
      const unreachable = libraryIds.filter((id) => !visible.has(id));
      if (unreachable.length) refuse('API_KEY_SCOPE_EXCEEDS_OWNER', `The owner cannot see libraries: ${unreachable.join(', ')}`);
    }

    return { access: input.access ?? 'read', permissions, admin, libraryIds, expiresAt: this.resolveExpiry(input.expiresInDays, settings) };
  }

  private resolveExpiry(expiresInDays: number | null | undefined, settings: ApiKeySettings): Date | null {
    const cap = settings.maxLifetimeDays;
    const days = expiresInDays === undefined ? Math.min(API_KEY_DEFAULT_EXPIRY_DAYS, cap ?? API_KEY_DEFAULT_EXPIRY_DAYS) : expiresInDays;
    if (cap !== null && (days === null || days > cap)) {
      throw new BadRequestException({
        message: `Keys on this server can last at most ${cap} days`,
        errorCode: 'API_KEY_EXPIRY_EXCEEDS_CAP',
        errorMeta: { cap },
      });
    }
    return days === null ? null : new Date(Date.now() + days * DAY_MS);
  }

  private async insert(ownerId: number, name: string, grant: ResolvedGrant, createdBy: number | null, replacesId?: number): Promise<CreatedApiKey> {
    const token = generateApiKeyToken();
    const row: NewApiKey = {
      userId: ownerId,
      createdBy,
      name,
      tokenHash: hashApiKeyToken(token),
      tokenHint: apiKeyHint(token),
      audience: 'api',
      access: grant.access,
      permissions: grant.permissions,
      admin: grant.admin,
      expiresAt: grant.expiresAt,
    };
    const result = await this.repo.insert(row, grant.libraryIds, API_KEY_MAX_ACTIVE_PER_USER, replacesId);
    if (result.status === 'limit_reached') {
      throw new ConflictException({
        message: `A user can have at most ${API_KEY_MAX_ACTIVE_PER_USER} active API keys`,
        errorCode: 'API_KEY_LIMIT_REACHED',
        errorMeta: { limit: API_KEY_MAX_ACTIVE_PER_USER },
      });
    }
    if (result.status === 'replaced_missing') throw new ConflictException('API key has been revoked');
    const record = await this.repo.findOwned(ownerId, result.id);
    if (!record) {
      this.logger.error(
        `[api-key.create] [fail] userId=${ownerId} keyId=${result.id} error="${sanitizeLogValue('created key not found')}" - API key vanished`,
      );
      throw new NotFoundException('API key not found');
    }
    return { key: toApiKeySummary(record), token };
  }
}
