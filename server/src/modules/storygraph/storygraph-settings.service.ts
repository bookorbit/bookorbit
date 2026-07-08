import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import type {
  StorygraphBookSyncMode,
  StorygraphCookieValidationResult,
  StorygraphSettings,
  StorygraphSyncDisabledReason,
  UpsertStorygraphSettingsPayload,
} from '@bookorbit/types';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { StorygraphClientService, type StorygraphCookies } from './storygraph-client.service';
import { StorygraphRepository } from './storygraph.repository';

const VALID_BOOK_SYNC_MODES: StorygraphBookSyncMode[] = ['all_eligible', 'selected_only'];

@Injectable()
export class StorygraphSettingsService {
  private readonly logger = new Logger(StorygraphSettingsService.name);

  constructor(
    private readonly repo: StorygraphRepository,
    private readonly client: StorygraphClientService,
  ) {}

  async getSettings(userId: number): Promise<StorygraphSettings> {
    const [row, hasSyncPermission] = await Promise.all([this.repo.findSettings(userId), this.repo.userHasStorygraphSyncPermission(userId)]);
    const cookiesConfigured = Boolean(row?.sessionCookie && row?.rememberToken);
    const enabled = row?.enabled ?? false;

    return {
      cookiesConfigured,
      enabled,
      effectiveEnabled: hasSyncPermission && cookiesConfigured && enabled,
      disabledReason: this.resolveDisabledReason({ hasSyncPermission, cookiesConfigured, enabled }),
      bookSyncMode: (row?.bookSyncMode ?? 'all_eligible') as StorygraphBookSyncMode,
      autoSyncOnStatusChange: row?.autoSyncOnStatusChange ?? true,
      autoSyncOnProgressUpdate: row?.autoSyncOnProgressUpdate ?? true,
      lastSyncedAt: row?.lastSyncedAt?.toISOString() ?? null,
    };
  }

  async upsertSettings(userId: number, payload: UpsertStorygraphSettingsPayload): Promise<StorygraphSettings> {
    const existing = await this.repo.findSettings(userId);

    const sessionCookie = payload.sessionCookie !== undefined ? payload.sessionCookie.trim() : undefined;
    const rememberToken = payload.rememberToken !== undefined ? payload.rememberToken.trim() : undefined;

    // A provided-but-blank cookie would otherwise slip past the ?? fallbacks below and
    // overwrite stored credentials with an empty string, silently breaking sync.
    if (sessionCookie === '' || rememberToken === '') {
      throw new BadRequestException('Cookie values cannot be empty');
    }
    if (!existing && (!sessionCookie || !rememberToken)) {
      throw new BadRequestException('Both the session cookie and remember token are required to connect StoryGraph');
    }
    if (payload.bookSyncMode !== undefined && !VALID_BOOK_SYNC_MODES.includes(payload.bookSyncMode)) {
      throw new BadRequestException(`Invalid bookSyncMode: ${payload.bookSyncMode}`);
    }

    const data: Parameters<typeof this.repo.upsertSettings>[1] = {};
    // Always carry both cookie values into the INSERT side so the NOT NULL constraints are satisfied.
    // PostgreSQL checks NOT NULL before ON CONFLICT, so even on a conflict-update path
    // the INSERT values must be valid.
    data.sessionCookie = sessionCookie ?? existing!.sessionCookie;
    data.rememberToken = rememberToken ?? existing!.rememberToken;
    if (payload.enabled !== undefined) data.enabled = payload.enabled;
    if (payload.bookSyncMode !== undefined) data.bookSyncMode = payload.bookSyncMode;
    if (payload.autoSyncOnStatusChange !== undefined) data.autoSyncOnStatusChange = payload.autoSyncOnStatusChange;
    if (payload.autoSyncOnProgressUpdate !== undefined) data.autoSyncOnProgressUpdate = payload.autoSyncOnProgressUpdate;

    await this.repo.upsertSettings(userId, data);
    return this.getSettings(userId);
  }

  async disconnectUser(userId: number): Promise<void> {
    const startedAt = Date.now();
    this.logger.log(`[storygraph.disconnect] [start] userId=${userId} - disconnect started`);
    try {
      const existing = await this.repo.findSettings(userId);
      if (!existing) throw new NotFoundException('StoryGraph integration not configured');
      await this.repo.deleteSettings(userId);
      this.logger.log(`[storygraph.disconnect] [end] userId=${userId} durationMs=${Date.now() - startedAt} - user disconnected`);
    } catch (err) {
      const errorClass = err instanceof Error ? err.constructor.name : 'Error';
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[storygraph.disconnect] [fail] userId=${userId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${error}" - disconnect failed`,
      );
      throw err;
    }
  }

  async validateCookies(userId: number, sessionCookie?: string, rememberToken?: string): Promise<StorygraphCookieValidationResult> {
    const startedAt = Date.now();
    let cookies: StorygraphCookies;

    const trimmedSession = sessionCookie?.trim();
    const trimmedRemember = rememberToken?.trim();
    const source = trimmedSession && trimmedRemember ? 'payload' : 'stored';
    this.logger.log(`[storygraph.validate_cookies] [start] userId=${userId} source=${source} - cookie validation started`);

    if (trimmedSession && trimmedRemember) {
      cookies = { sessionCookie: trimmedSession, rememberToken: trimmedRemember };
    } else {
      const settings = await this.repo.findSettings(userId);
      if (!settings) {
        this.logger.log(
          `[storygraph.validate_cookies] [end] userId=${userId} durationMs=${Date.now() - startedAt} valid=false - cookie validation completed`,
        );
        return { valid: false };
      }
      cookies = { sessionCookie: settings.sessionCookie, rememberToken: settings.rememberToken };
    }

    try {
      const response = await this.client.get(userId, cookies, '/journal');
      const valid = response.status === 200 && !response.redirectedToSignIn;
      this.logger.log(
        `[storygraph.validate_cookies] [end] userId=${userId} durationMs=${Date.now() - startedAt} valid=${valid} - cookie validation completed`,
      );
      return { valid };
    } catch (err) {
      const errorClass = err instanceof Error ? err.constructor.name : 'Error';
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[storygraph.validate_cookies] [fail] userId=${userId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${error}" - cookie validation failed`,
      );
      return { valid: false };
    }
  }

  async getCookiesForUser(userId: number): Promise<StorygraphCookies | null> {
    const [settings, hasSyncPermission] = await Promise.all([this.repo.findSettings(userId), this.repo.userHasStorygraphSyncPermission(userId)]);
    if (!hasSyncPermission) return null;
    if (!settings || !settings.enabled) return null;
    return { sessionCookie: settings.sessionCookie, rememberToken: settings.rememberToken };
  }

  private resolveDisabledReason(input: {
    hasSyncPermission: boolean;
    cookiesConfigured: boolean;
    enabled: boolean;
  }): StorygraphSyncDisabledReason | null {
    if (!input.hasSyncPermission) return 'permission_denied';
    if (!input.cookiesConfigured) return 'missing_cookies';
    if (!input.enabled) return 'user_disabled';
    return null;
  }
}
