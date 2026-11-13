import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import type {
  HardcoverBookSyncMode,
  HardcoverSettings,
  HardcoverSyncDisabledReason,
  HardcoverTokenValidationResult,
  UpsertHardcoverSettingsPayload,
} from '@bookorbit/types';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { HARDCOVER_PRIVACY } from './hardcover.constants';
import { HardcoverClientService } from './hardcover-client.service';
import { HardcoverRepository } from './hardcover.repository';

const VALID_PRIVACY_IDS = [HARDCOVER_PRIVACY.PUBLIC, HARDCOVER_PRIVACY.FOLLOWS, HARDCOVER_PRIVACY.PRIVATE];
const VALID_BOOK_SYNC_MODES = ['all_eligible', 'selected_only'] as const;

@Injectable()
export class HardcoverSettingsService {
  private readonly logger = new Logger(HardcoverSettingsService.name);

  constructor(
    private readonly repo: HardcoverRepository,
    private readonly client: HardcoverClientService,
  ) {}

  async getSettings(userId: number): Promise<HardcoverSettings> {
    const [row, hasSyncPermission] = await Promise.all([this.repo.findSettings(userId), this.repo.userHasHardcoverSyncPermission(userId)]);
    const tokenConfigured = Boolean(row?.apiToken);
    const enabled = row?.enabled ?? false;

    return {
      tokenConfigured,
      enabled,
      effectiveEnabled: hasSyncPermission && tokenConfigured && enabled,
      disabledReason: this.resolveDisabledReason({ hasSyncPermission, tokenConfigured, enabled }),
      bookSyncMode: (row?.bookSyncMode ?? 'all_eligible') as HardcoverBookSyncMode,
      autoSyncOnStatusChange: row?.autoSyncOnStatusChange ?? true,
      autoSyncOnProgressUpdate: row?.autoSyncOnProgressUpdate ?? true,
      autoSyncOnRatingChange: row?.autoSyncOnRatingChange ?? true,
      privacySettingId: row?.privacySettingId ?? HARDCOVER_PRIVACY.PRIVATE,
      excludedLibraryIds: row?.excludedLibraryIds ?? [],
      lastSyncedAt: row?.lastSyncedAt?.toISOString() ?? null,
    };
  }

  async upsertSettings(userId: number, payload: UpsertHardcoverSettingsPayload): Promise<HardcoverSettings> {
    if (payload.privacySettingId !== undefined && !VALID_PRIVACY_IDS.includes(payload.privacySettingId as 1 | 2 | 3)) {
      throw new BadRequestException(`Invalid privacySettingId: ${payload.privacySettingId}`);
    }
    if (payload.bookSyncMode !== undefined && !VALID_BOOK_SYNC_MODES.includes(payload.bookSyncMode)) {
      throw new BadRequestException(`Invalid bookSyncMode: ${payload.bookSyncMode}`);
    }

    const existing = await this.repo.findSettings(userId);

    const rawToken = payload.apiToken !== undefined ? this.stripBearerPrefix(payload.apiToken.trim()) : undefined;

    if (!existing && !rawToken) {
      throw new BadRequestException('API token is required to connect Hardcover');
    }

    const data: Parameters<typeof this.repo.upsertSettings>[1] = {};
    // Always carry a token into the INSERT side so the NOT NULL constraint is satisfied.
    // PostgreSQL checks NOT NULL before ON CONFLICT, so even on a conflict-update path
    // the INSERT values must be valid.
    data.apiToken = rawToken ?? existing!.apiToken;
    if (payload.enabled !== undefined) data.enabled = payload.enabled;
    if (payload.bookSyncMode !== undefined) data.bookSyncMode = payload.bookSyncMode;
    if (payload.autoSyncOnStatusChange !== undefined) data.autoSyncOnStatusChange = payload.autoSyncOnStatusChange;
    if (payload.autoSyncOnProgressUpdate !== undefined) data.autoSyncOnProgressUpdate = payload.autoSyncOnProgressUpdate;
    if (payload.autoSyncOnRatingChange !== undefined) data.autoSyncOnRatingChange = payload.autoSyncOnRatingChange;
    if (payload.privacySettingId !== undefined) data.privacySettingId = payload.privacySettingId;
    if (payload.excludedLibraryIds !== undefined) data.excludedLibraryIds = [...new Set(payload.excludedLibraryIds)].sort((a, b) => a - b);

    await this.repo.upsertSettings(userId, data);
    return this.getSettings(userId);
  }

  async disconnectUser(userId: number): Promise<void> {
    const existing = await this.repo.findSettings(userId);
    if (!existing) throw new NotFoundException('Hardcover integration not configured');
    await this.repo.deleteSettings(userId);
    this.logger.log(`[hardcover.disconnect] [end] userId=${userId} - user disconnected`);
  }

  async validateToken(userId: number, token?: string): Promise<HardcoverTokenValidationResult> {
    let resolvedToken = this.stripBearerPrefix(token?.trim());
    if (!resolvedToken) {
      const settings = await this.repo.findSettings(userId);
      if (!settings) return { valid: false };
      resolvedToken = settings.apiToken;
    }

    try {
      const data = await this.client.query<{ me: { username: string }[] }>(userId, resolvedToken, `query { me { username } }`);
      const username = data.me?.[0]?.username;
      if (!username) return { valid: false };
      return { valid: true, hardcoverUsername: username };
    } catch (err) {
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(`[hardcover.validate_token] [fail] userId=${userId} error="${error}" - token validation failed`);
      return { valid: false };
    }
  }

  async getTokenForUser(userId: number): Promise<string | null> {
    const [settings, hasSyncPermission] = await Promise.all([this.repo.findSettings(userId), this.repo.userHasHardcoverSyncPermission(userId)]);
    if (!hasSyncPermission) return null;
    if (!settings || !settings.enabled) return null;
    return settings.apiToken;
  }

  private stripBearerPrefix(token: string | undefined): string | undefined {
    if (!token) return token;
    const lower = token.toLowerCase();
    return lower.startsWith('bearer ') ? token.slice(7).trim() : token;
  }

  private resolveDisabledReason(input: {
    hasSyncPermission: boolean;
    tokenConfigured: boolean;
    enabled: boolean;
  }): HardcoverSyncDisabledReason | null {
    if (!input.hasSyncPermission) return 'permission_denied';
    if (!input.tokenConfigured) return 'missing_token';
    if (!input.enabled) return 'user_disabled';
    return null;
  }
}
