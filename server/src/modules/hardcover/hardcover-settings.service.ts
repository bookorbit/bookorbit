import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import type { HardcoverAdminSettings, HardcoverSettings, HardcoverTokenValidationResult, UpsertHardcoverSettingsPayload } from '@bookorbit/types';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { HARDCOVER_PRIVACY } from './hardcover.constants';
import { HardcoverClientService } from './hardcover-client.service';
import { HardcoverRepository } from './hardcover.repository';

const VALID_PRIVACY_IDS = [HARDCOVER_PRIVACY.PUBLIC, HARDCOVER_PRIVACY.FOLLOWS, HARDCOVER_PRIVACY.PRIVATE];

@Injectable()
export class HardcoverSettingsService {
  private readonly logger = new Logger(HardcoverSettingsService.name);

  constructor(
    private readonly repo: HardcoverRepository,
    private readonly client: HardcoverClientService,
    private readonly appSettings: AppSettingsService,
  ) {}

  async isFeatureEnabled(): Promise<boolean> {
    return this.appSettings.isHardcoverEnabled();
  }

  async setFeatureEnabled(enabled: boolean): Promise<void> {
    await this.appSettings.setHardcoverEnabled(enabled);
    this.logger.log(`[hardcover.admin_toggle] [end] enabled=${enabled} - feature toggled`);
  }

  async getAdminSettings(): Promise<HardcoverAdminSettings> {
    return { featureEnabled: await this.isFeatureEnabled() };
  }

  async getSettings(userId: number): Promise<HardcoverSettings> {
    const row = await this.repo.findSettings(userId);
    if (!row) {
      return {
        tokenConfigured: false,
        enabled: false,
        autoSyncOnStatusChange: true,
        autoSyncOnProgressUpdate: true,
        autoSyncOnRatingChange: true,
        privacySettingId: HARDCOVER_PRIVACY.PRIVATE,
        lastSyncedAt: null,
      };
    }
    return {
      tokenConfigured: true,
      enabled: row.enabled,
      autoSyncOnStatusChange: row.autoSyncOnStatusChange,
      autoSyncOnProgressUpdate: row.autoSyncOnProgressUpdate,
      autoSyncOnRatingChange: row.autoSyncOnRatingChange,
      privacySettingId: row.privacySettingId,
      lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    };
  }

  async upsertSettings(userId: number, payload: UpsertHardcoverSettingsPayload): Promise<HardcoverSettings> {
    if (payload.privacySettingId !== undefined && !VALID_PRIVACY_IDS.includes(payload.privacySettingId as 1 | 2 | 3)) {
      throw new BadRequestException(`Invalid privacySettingId: ${payload.privacySettingId}`);
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
    if (payload.autoSyncOnStatusChange !== undefined) data.autoSyncOnStatusChange = payload.autoSyncOnStatusChange;
    if (payload.autoSyncOnProgressUpdate !== undefined) data.autoSyncOnProgressUpdate = payload.autoSyncOnProgressUpdate;
    if (payload.autoSyncOnRatingChange !== undefined) data.autoSyncOnRatingChange = payload.autoSyncOnRatingChange;
    if (payload.privacySettingId !== undefined) data.privacySettingId = payload.privacySettingId;

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
    const settings = await this.repo.findSettings(userId);
    if (!settings || !settings.enabled) return null;
    return settings.apiToken;
  }

  private stripBearerPrefix(token: string | undefined): string | undefined {
    if (!token) return token;
    const lower = token.toLowerCase();
    return lower.startsWith('bearer ') ? token.slice(7).trim() : token;
  }
}
