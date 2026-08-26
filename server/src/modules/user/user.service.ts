import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash } from 'bcryptjs';
import { randomBytes } from 'crypto';
import { Permission } from '@bookorbit/types';
import type { ProvisioningMethod, UserAttentionResponse, UserListSummary, UserSettings } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { resolveTimeZone } from '../../common/utils/timezone.utils';
import { ContentFilterRepository } from './content-filter.repository';
import { CreateUserDto } from './dto/create-user.dto';
import { CreateSharedUserDto } from './dto/create-shared-user.dto';
import { SetPermissionsDto } from './dto/set-permissions.dto';
import { SetContentFiltersDto } from './dto/set-content-filters.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateMeSettingsDto } from './dto/update-me-settings.dto';
import { UpdateSeriesCollapsePreferencesDto } from './dto/update-series-collapse-preferences.dto';
import { USER_DELETING, UserEventsService, type UserDeletingEvent } from './user-events.service';
import { UserRepository, type UserListQuery } from './user.repository';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { UserStatisticsService } from '../user-statistics/user-statistics.service';

/** The band is a to-do list, not a second roster. */
const ATTENTION_BAND_LIMIT = 8;

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);
  private readonly achievementEnabledCache = new Map<number, { enabled: boolean; expiresAt: number }>();

  constructor(
    private readonly userRepo: UserRepository,
    private readonly config: ConfigService,
    private readonly contentFilterRepo: ContentFilterRepository,
    private readonly appSettingsService: AppSettingsService,
    private readonly userStatistics: UserStatisticsService,
    private readonly events: UserEventsService,
  ) {}

  findByUsername(username: string) {
    return this.userRepo.findByUsername(username);
  }

  findByEmail(email: string) {
    return this.userRepo.findByEmail(email);
  }

  findByOidcSubject(subject: string, issuer: string) {
    return this.userRepo.findByOidcSubject(subject, issuer);
  }

  linkOidcIdentity(userId: number, oidcSubject: string, oidcIssuer: string, avatarUrl?: string) {
    return this.userRepo.linkOidcIdentity(userId, oidcSubject, oidcIssuer, avatarUrl);
  }

  unlinkOidcIdentity(userId: number) {
    return this.userRepo.unlinkOidcIdentity(userId);
  }

  getUserOidcIdentity(userId: number) {
    return this.userRepo.getUserOidcIdentity(userId);
  }

  findPasswordHashById(userId: number) {
    return this.userRepo.findPasswordHashById(userId);
  }

  async createOidcUser(data: Parameters<UserRepository['createOidcUser']>[0]) {
    const user = await this.userRepo.createOidcUser(data);
    await this.assignConfiguredDefaultLibraries(user.id);
    return user;
  }

  generatePasswordResetToken(userId: number): Promise<string> {
    return this.userRepo.generateResetToken(userId);
  }

  incrementTokenVersion(userId: number) {
    return this.userRepo.incrementTokenVersion(userId);
  }

  findByIdWithPermissions(id: number): Promise<RequestUser | null> {
    return this.userRepo.findByIdWithPermissions(id);
  }

  create(data: Parameters<UserRepository['create']>[0]) {
    return this.userRepo.create(data);
  }

  findAll(query: UserListQuery) {
    return this.userRepo.findAll(query);
  }

  findAssignable() {
    return this.userRepo.findAssignable();
  }

  summary(): Promise<UserListSummary> {
    return this.userRepo.summary();
  }

  /**
   * The roster's attention band. Capped because the band is a to-do list, not a second
   * roster; `total` tells the UI when there is more behind the `attention` filter.
   */
  async findNeedingAttention(): Promise<UserAttentionResponse> {
    const [rows, summary] = await Promise.all([this.userRepo.findNeedingAttention(ATTENTION_BAND_LIMIT), this.userRepo.summary()]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        username: row.username,
        name: row.name,
        avatarUrl: row.avatarUrl,
        provisioningMethod: row.provisioningMethod as ProvisioningMethod,
        reason: row.reason,
        lockedUntil: row.lockedUntil?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        resetLinkExpiresAt: row.resetLinkExpiresAt?.toISOString() ?? null,
      })),
      total: summary.attention,
    };
  }

  async findById(id: number) {
    const user = await this.userRepo.findByIdWithPermissions(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async createUser(dto: CreateUserDto) {
    const existing = await this.userRepo.findByUsername(dto.username);
    if (existing) throw new ConflictException('Username already taken');
    const existingEmail = await this.userRepo.findByEmail(dto.email);
    if (existingEmail) throw new ConflictException('Email already in use');

    const passwordHash = await hash(randomBytes(16).toString('hex'), 12);
    const user = await this.userRepo.create({
      username: dto.username,
      name: dto.name,
      email: dto.email,
      passwordHash,
      isDefaultPassword: true,
    });

    const permissionNames = this.uniquePermissions(dto.permissionNames ?? []);
    if (permissionNames.length > 0) {
      await this.userRepo.setPermissions(user.id, permissionNames);
    }

    const libraryIds = await this.resolveNewUserLibraryIds(dto.libraryIds);
    if (libraryIds.length > 0) {
      await this.assertKnownLibraryIds(libraryIds);
      await this.userRepo.assignViewerLibraries(user.id, libraryIds);
    }

    const appUrl = this.config.get<string>('app.appUrl') ?? 'http://localhost:5173';
    const rawToken = await this.userRepo.generateResetToken(user.id);
    const resetUrl = `${appUrl}/reset-password?token=${rawToken}`;

    return { id: user.id, username: user.username, name: user.name, resetUrl };
  }

  async createSharedUser(dto: CreateSharedUserDto) {
    const existing = await this.userRepo.findByUsername(dto.username);
    if (existing) throw new ConflictException('Username already taken');
    if (dto.email) {
      const existingEmail = await this.userRepo.findByEmail(dto.email);
      if (existingEmail) throw new ConflictException('Email already in use');
    }

    const passwordHash = await hash(randomBytes(32).toString('hex'), 12);
    const user = await this.userRepo.create({
      username: dto.username,
      name: dto.name,
      email: dto.email ?? null,
      passwordHash,
      isDefaultPassword: false,
      provisioningMethod: 'shared',
    });

    const permissionNames = this.uniquePermissions(dto.permissionNames ?? []);
    if (permissionNames.length > 0) {
      await this.userRepo.setPermissions(user.id, permissionNames);
    }

    const libraryIds = await this.resolveNewUserLibraryIds(dto.libraryIds);
    if (libraryIds.length > 0) {
      await this.assertKnownLibraryIds(libraryIds);
      await this.userRepo.assignViewerLibraries(user.id, libraryIds);
    }

    return { id: user.id, username: user.username, name: user.name };
  }

  async updateUser(id: number, dto: UpdateUserDto, requestingUser: RequestUser) {
    if (id === requestingUser.id && dto.active === false) {
      throw new ConflictException('You cannot deactivate your own account');
    }

    const target = await this.userRepo.findByIdWithPermissions(id);
    if (!target) throw new NotFoundException('User not found');

    if (target.isSuperuser && !requestingUser.isSuperuser) {
      throw new ForbiddenException('Only administrators can edit administrator accounts');
    }

    if (dto.email !== undefined && dto.email !== null) {
      await this.assertEmailAvailable(dto.email, id);
    }

    if (dto.active === false && target.isSuperuser) {
      const otherSuperusers = await this.userRepo.countOtherSuperusers(id);
      if (otherSuperusers === 0) {
        throw new ConflictException('Cannot deactivate the last administrator');
      }
    }

    const user = await this.userRepo.update(id, dto);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateMe(userId: number, dto: UpdateMeDto) {
    const user = await this.userRepo.update(userId, dto);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateMySettings(userId: number, dto: UpdateMeSettingsDto) {
    // Settings are merged server-side, so the stored row is the only place the outgoing
    // timezone still exists. Read only when this write is the one that can replace it.
    const touchesTimeZone = Object.prototype.hasOwnProperty.call(dto.settings, 'timezone');
    const previousSettings = touchesTimeZone ? await this.userRepo.findSettingsById(userId) : null;

    const user = await this.userRepo.update(userId, { settings: dto.settings });
    if (!user) throw new NotFoundException('User not found');
    this.updateAchievementEnabledCache(userId, dto.settings);

    if (touchesTimeZone) {
      void this.rebuildReadingStatsForSubmittedTimeZone(userId, previousSettings, user.settings as Record<string, unknown> | null);
    }
    return user;
  }

  /**
   * Daily reading stats are stored per local day, so the timezone that produced a row is baked
   * into it. The hourly aggregation only revisits the last couple of days, which leaves every
   * older row attributed to the zone the user has just corrected, and a streak broken at the
   * old day boundary stays broken. The rebuild is what makes the new setting retroactive.
   *
   * Submitting a timezone rebuilds even when it matches the stored one. The rebuild is
   * idempotent, and skipping the unchanged case would make a failure permanent: the setting is
   * saved either way, so saving it again is the only retry a user has, and that retry is
   * exactly the case where nothing appears to have changed.
   *
   * A failure does not fail the save. The setting itself is already stored, and refusing the
   * write would leave the user with neither the setting nor a way to ask for it again.
   *
   * Detached for the same reason the bootstrap backfill is: this walks the reader's whole
   * history, and the response neither returns its result nor depends on it, so awaiting it
   * would hold the request open for a long library and nothing else.
   */
  private async rebuildReadingStatsForSubmittedTimeZone(
    userId: number,
    previousSettings: Record<string, unknown> | null,
    nextSettings: Record<string, unknown> | null,
  ): Promise<void> {
    const previousTimeZone = resolveTimeZone(previousSettings?.['timezone'], 'UTC');
    const nextTimeZone = resolveTimeZone(nextSettings?.['timezone'], 'UTC');

    const event = 'user.reading_stats_rebuild';
    const startedAt = Date.now();
    this.logger.log(
      `[${event}] [start] userId=${userId} previousTimeZone="${sanitizeLogValue(previousTimeZone)}" timeZone="${sanitizeLogValue(nextTimeZone)}" - rebuilding daily reading stats after a timezone change`,
    );

    try {
      const result = await this.userStatistics.rebuildDailyStatsForUser(userId, nextTimeZone);
      this.logger.log(
        `[${event}] [end] userId=${userId} timeZone="${sanitizeLogValue(nextTimeZone)}" durationMs=${Date.now() - startedAt} libraries=${result.libraries} deleted=${result.deleted} inserted=${result.inserted} - daily reading stats rebuilt`,
      );
    } catch (error) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      const message = sanitizeLogValue(error instanceof Error ? error.message : 'unknown error');
      this.logger.warn(
        `[${event}] [fail] userId=${userId} timeZone="${sanitizeLogValue(nextTimeZone)}" durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${message}" - daily reading stats rebuild failed`,
      );
    }
  }

  async isAchievementEnabled(userId: number): Promise<boolean> {
    const cached = this.achievementEnabledCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.enabled;

    const settings = await this.userRepo.findSettingsById(userId);
    const enabled = settings !== null && this.readAchievementEnabled(settings);
    this.cacheAchievementEnabled(userId, enabled);
    return enabled;
  }

  async updateReaderStorageMode(userId: number, sync: boolean) {
    const user = await this.userRepo.update(userId, { settings: { syncReaderPreferences: sync } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateThemeStorageMode(userId: number, sync: boolean) {
    const user = await this.userRepo.update(userId, { settings: { syncThemePreferences: sync } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private updateAchievementEnabledCache(userId: number, settings: Record<string, unknown>): void {
    const preferences = settings['achievementPreferences'];
    if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
      this.achievementEnabledCache.delete(userId);
      return;
    }

    this.cacheAchievementEnabled(userId, this.readAchievementEnabled(settings));
  }

  private cacheAchievementEnabled(userId: number, enabled: boolean): void {
    this.achievementEnabledCache.set(userId, { enabled, expiresAt: Date.now() + 60_000 });
  }

  private readAchievementEnabled(settings: Record<string, unknown>): boolean {
    const preferences = settings['achievementPreferences'];
    if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) return true;
    return (preferences as Record<string, unknown>)['enabled'] !== false;
  }

  async deleteUser(id: number, requestingUser: RequestUser) {
    if (id === requestingUser.id) {
      throw new ConflictException('You cannot delete your own account');
    }
    const [target, otherSuperusers] = await Promise.all([this.userRepo.findByIdWithPermissions(id), this.userRepo.countOtherSuperusers(id)]);
    if (!target) throw new NotFoundException('User not found');
    if (target?.isSuperuser) {
      if (!requestingUser.isSuperuser) throw new ForbiddenException('Only administrators can delete administrator accounts');
      if (otherSuperusers === 0) throw new ConflictException('Cannot delete the last administrator');
    }

    await this.announceDeletion(id);
    await this.userRepo.delete(id);
  }

  /**
   * Gives everything holding work on this account's behalf the chance to stop it, before the
   * cascade removes the only rows that say the work exists.
   *
   * Awaited, because running afterwards would be pointless: a torrent whose attempt row is gone
   * cannot be found again. Failures are logged and the deletion proceeds - an account the operator
   * asked to remove must go, and the alternative to a leaked torrent is an account that cannot be
   * deleted at all.
   */
  private async announceDeletion(userId: number): Promise<void> {
    const pending: Promise<void>[] = [];
    const event: UserDeletingEvent = { userId, waitFor: (work) => pending.push(work) };
    try {
      this.events.emit(USER_DELETING, event);
    } catch (error: unknown) {
      // A listener that threw before it could register anything, which is still not a reason to
      // refuse the deletion; whatever it holds is reported here and left running.
      pending.push(Promise.reject(error instanceof Error ? error : new Error(String(error))));
    }
    if (pending.length === 0) return;

    for (const outcome of await Promise.allSettled(pending)) {
      if (outcome.status !== 'rejected') continue;
      const message = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      this.logger.warn(
        `[user.delete] [fail] userId=${userId} error="${sanitizeLogValue(message)}" - work belonging to this account could not be stopped before deletion`,
      );
    }
  }

  setPermissionsDirectly(userId: number, permissionNames: Permission[]) {
    return this.userRepo.setPermissions(userId, permissionNames);
  }

  async setPermissions(targetUserId: number, dto: SetPermissionsDto, requestingUser: RequestUser) {
    if (targetUserId === requestingUser.id) {
      throw new ConflictException('You cannot modify your own permissions');
    }
    const target = await this.userRepo.findByIdWithPermissions(targetUserId);
    if (!target) throw new NotFoundException('User not found');

    if (target.isSuperuser && !requestingUser.isSuperuser) {
      throw new ForbiddenException('Only administrators can modify administrator permissions');
    }

    const permissionNames = this.uniquePermissions(dto.permissionNames);
    await this.userRepo.setPermissions(targetUserId, permissionNames);
  }

  async setSuperuser(targetUserId: number, isSuperuser: boolean, requestingUser: RequestUser) {
    if (!requestingUser.isSuperuser) {
      throw new ForbiddenException('Only administrators can change superuser status');
    }
    if (targetUserId === requestingUser.id) {
      throw new ConflictException('You cannot change your own superuser status');
    }
    const target = await this.userRepo.findByIdWithPermissions(targetUserId);
    if (!target) throw new NotFoundException('User not found');
    if (target.provisioningMethod === 'shared') {
      throw new BadRequestException('Shared accounts cannot be made superuser');
    }
    if (!isSuperuser && target.isSuperuser) {
      const otherSuperusers = await this.userRepo.countOtherSuperusers(targetUserId);
      if (otherSuperusers === 0) {
        throw new ConflictException('Cannot remove the last administrator');
      }
    }
    await this.userRepo.setSuperuser(targetUserId, isSuperuser);
  }

  async getLibraryIds(userId: number): Promise<number[]> {
    const user = await this.userRepo.findByIdWithPermissions(userId);
    if (!user) throw new NotFoundException('User not found');
    return this.userRepo.findLibraryIdsByUserId(userId);
  }

  async setLibraries(targetUserId: number, libraryIds: number[], requestingUser: RequestUser): Promise<void> {
    const target = await this.userRepo.findByIdWithPermissions(targetUserId);
    if (!target) throw new NotFoundException('User not found');
    if (target.isSuperuser && !requestingUser.isSuperuser) {
      throw new ForbiddenException('Only administrators can edit administrator accounts');
    }

    const normalizedLibraryIds = this.uniqueIds(libraryIds);
    await this.assertKnownLibraryIds(normalizedLibraryIds);
    await this.userRepo.replaceViewerLibraries(targetUserId, normalizedLibraryIds);
  }

  async adminResetPassword(targetUserId: number, requestingUser: RequestUser) {
    const target = await this.userRepo.findByIdWithPermissions(targetUserId);
    if (!target) throw new NotFoundException('User not found');
    if (target.isSuperuser && !requestingUser.isSuperuser) {
      throw new ForbiddenException('Only administrators can reset administrator passwords');
    }
    if (target.provisioningMethod === 'oidc') {
      throw new BadRequestException('OIDC accounts cannot reset their password here');
    }
    if (target.provisioningMethod === 'shared') {
      throw new BadRequestException('Shared accounts do not have passwords');
    }
    const appUrl = this.config.get<string>('app.appUrl') ?? 'http://localhost:5173';
    const rawToken = await this.userRepo.generateResetToken(targetUserId);
    return { resetUrl: `${appUrl}/reset-password?token=${rawToken}` };
  }

  async unlockUser(targetUserId: number, requestingUser: RequestUser) {
    const target = await this.userRepo.findByIdWithPermissions(targetUserId);
    if (!target) throw new NotFoundException('User not found');
    if (target.isSuperuser && !requestingUser.isSuperuser) {
      throw new ForbiddenException('Only administrators can unlock administrator accounts');
    }
    await this.userRepo.clearLockout(targetUserId);
    return { unlocked: true };
  }

  private uniquePermissions(permissionNames: Permission[]): Permission[] {
    return Array.from(new Set(permissionNames));
  }

  private uniqueIds(ids: number[]): number[] {
    return Array.from(new Set(ids));
  }

  private async resolveNewUserLibraryIds(libraryIds: number[] | undefined): Promise<number[]> {
    if (libraryIds !== undefined) return this.uniqueIds(libraryIds);
    return this.appSettingsService.getDefaultLibraryAccessLibraryIds();
  }

  private async assignConfiguredDefaultLibraries(userId: number): Promise<void> {
    const libraryIds = await this.appSettingsService.getDefaultLibraryAccessLibraryIds();
    if (libraryIds.length === 0) return;
    await this.userRepo.assignViewerLibraries(userId, libraryIds);
  }

  private async assertEmailAvailable(email: string, targetUserId: number): Promise<void> {
    const existing = await this.userRepo.findByEmail(email);
    if (existing && existing.id !== targetUserId) {
      throw new ConflictException('Email already in use');
    }
  }

  private async assertKnownLibraryIds(libraryIds: number[]): Promise<void> {
    if (libraryIds.length === 0) return;
    const existingIds = await this.userRepo.findExistingLibraryIds(libraryIds);
    const existingSet = new Set(existingIds);
    const missing = libraryIds.filter((id) => !existingSet.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(`Unknown library IDs: ${missing.join(', ')}`);
    }
  }

  async updateSeriesCollapsePreferences(userId: number, dto: UpdateSeriesCollapsePreferencesDto): Promise<void> {
    const existing = await this.userRepo.findByIdWithPermissions(userId);
    if (!existing) throw new NotFoundException('User not found');
    const currentPrefs = (existing.settings as UserSettings)?.seriesCollapsePreferences ?? {
      global: false,
      libraries: {},
      collections: {},
      smartScopes: {},
    };
    const merged = {
      global: dto.global !== undefined ? dto.global : currentPrefs.global,
      libraries: { ...currentPrefs.libraries, ...(dto.libraries ?? {}) },
      collections: { ...currentPrefs.collections, ...(dto.collections ?? {}) },
      smartScopes: { ...(currentPrefs.smartScopes ?? {}), ...(dto.smartScopes ?? {}) },
    };

    // Remove entries set to null (deletion of overrides)
    for (const [k, v] of Object.entries(merged.libraries)) {
      if (v === null) delete merged.libraries[k];
    }
    for (const [k, v] of Object.entries(merged.collections)) {
      if (v === null) delete merged.collections[k];
    }
    for (const [k, v] of Object.entries(merged.smartScopes)) {
      if (v === null) delete merged.smartScopes[k];
    }

    await this.userRepo.update(userId, { settings: { seriesCollapsePreferences: merged } });
  }

  async getContentFilters(targetUserId: number, requestingUser: RequestUser) {
    const target = await this.userRepo.findByIdWithPermissions(targetUserId);
    if (!target) throw new NotFoundException('User not found');
    if (targetUserId !== requestingUser.id && !requestingUser.isSuperuser) {
      throw new ForbiddenException('Cannot view another user content filters');
    }
    return this.contentFilterRepo.findByUserIdWithNames(targetUserId);
  }

  async setContentFilters(targetUserId: number, dto: SetContentFiltersDto, requestingUser: RequestUser) {
    const target = await this.userRepo.findByIdWithPermissions(targetUserId);
    if (!target) throw new NotFoundException('User not found');
    if (!requestingUser.isSuperuser) {
      throw new ForbiddenException('Only administrators can set content filters');
    }
    if (target.isSuperuser) {
      throw new BadRequestException('Content filters cannot be applied to administrators');
    }
    const filters = {
      includeTagIds: dto.includeTagIds ?? [],
      excludeTagIds: dto.excludeTagIds ?? [],
      includeGenreIds: dto.includeGenreIds ?? [],
      excludeGenreIds: dto.excludeGenreIds ?? [],
    };
    await this.contentFilterRepo.replaceFilters(targetUserId, filters);

    if (dto.seeOwnRequestedBooks !== undefined) {
      await this.userRepo.update(targetUserId, { seeOwnRequestedBooks: dto.seeOwnRequestedBooks });
    }
  }
}
