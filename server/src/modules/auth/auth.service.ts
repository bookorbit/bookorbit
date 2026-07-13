import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  InternalServerErrorException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import '@fastify/cookie';
import { and, count, eq, gt, isNull, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { AuditAction } from '@bookorbit/types';

import { APP_SETTING_KEYS } from '../../common/constants/app-settings.constants';
import { DB } from '../../db/db.module';
import * as schema from '../../db/schema';
import { AUDIT_EVENT, AuditEventsService } from '../audit/audit-events.service';
import type { RequestUser } from '../../common/types/request-user';
import { resolveUserAvatarUrl } from '../../common/utils/user-avatar-url';
import { SystemMailService } from '../email/system-mail.service';
import { UserService } from '../user/user.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SetupDto } from './dto/setup.dto';
import { OidcDiscoveryService } from './oidc/oidc-discovery.service';
import { OidcSessionRepository } from './oidc/oidc-session.repository';
import { MagicLinkRepository } from './magic-link.repository';
import { AppSettingsService } from '../app-settings/app-settings.service';

function parseDurationMs(duration: string): number {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) {
    throw new InternalServerErrorException(`Invalid auth duration config value: ${duration}`);
  }
  const n = parseInt(match[1], 10);
  const units: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return n * units[match[2]];
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const LOGIN_LOCKOUT_THRESHOLD = 5;
const LOGIN_LOCKOUT_DURATION_MS = 15 * 60_000;
const ROTATION_CHAIN_MAX_HOPS = 5;
const DUMMY_HASH = '$2a$12$LJ3m4ys3Lk0TSwHBbqP8b.3bFfR1oVDMhPzX8KPrPeuMEJBJJPa.G';

class ConcurrentRotationError extends Error {}

function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***@${email.slice(at + 1)}`;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly systemMailService: SystemMailService,
    private readonly oidcSessionRepo: OidcSessionRepository,
    private readonly oidcDiscovery: OidcDiscoveryService,
    private readonly auditEvents: AuditEventsService,
    private readonly magicLinkRepo: MagicLinkRepository,
    private readonly appSettings: AppSettingsService,
    @Inject(DB) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async register(dto: RegisterDto) {
    const setting = await this.db.query.appSettings.findFirst({
      where: eq(schema.appSettings.key, APP_SETTING_KEYS.ALLOW_REGISTRATION),
    });
    if (setting?.value !== 'true') {
      throw new ForbiddenException('Registration is not open');
    }

    const defaultLibraryIds = await this.appSettings.getDefaultLibraryAccessLibraryIds();
    const passwordHash = await hash(dto.password, 12);
    return this.db.transaction(async (tx) => {
      const existingUsername = await tx.query.users.findFirst({
        where: eq(sql`lower(${schema.users.username})`, dto.username.toLowerCase()),
      });
      if (existingUsername) throw new ConflictException('Registration failed');

      if (dto.email) {
        const existingEmail = await tx.query.users.findFirst({
          where: eq(sql`lower(${schema.users.email})`, dto.email.toLowerCase()),
        });
        if (existingEmail) throw new ConflictException('Registration failed');
      }

      const [user] = await tx
        .insert(schema.users)
        .values({
          username: dto.username,
          name: dto.name,
          email: dto.email,
          passwordHash,
          isDefaultPassword: false,
        })
        .returning({ id: schema.users.id, username: schema.users.username, name: schema.users.name });

      if (defaultLibraryIds.length > 0) {
        await tx
          .insert(schema.userLibraryAccess)
          .values(defaultLibraryIds.map((libraryId) => ({ userId: user.id, libraryId, accessLevel: 'viewer' as const })))
          .onConflictDoNothing();
      }

      this.logger.log(`[auth.register] [end] userId=${user.id} username=${user.username} - registration completed`);

      this.auditEvents.emit(AUDIT_EVENT, {
        userId: user.id,
        actorUsername: user.username,
        action: AuditAction.AuthRegister,
        description: `User '${user.username}' registered`,
      });

      return user;
    });
  }

  async setupStatus(): Promise<{ needsSetup: boolean }> {
    const count = await this.db.$count(schema.users);
    return { needsSetup: count === 0 };
  }

  async setup(dto: SetupDto, setupToken: string | undefined, reply: FastifyReply) {
    this.assertSetupToken(setupToken);
    const passwordHash = await hash(dto.password, 12);

    const created = await this.db.transaction(async (tx) => {
      const [setupMarker] = await tx
        .insert(schema.appSettings)
        .values({ key: APP_SETTING_KEYS.INITIAL_SETUP_COMPLETED_AT, value: new Date().toISOString() })
        .onConflictDoNothing({ target: schema.appSettings.key })
        .returning({ id: schema.appSettings.id });
      if (!setupMarker) {
        throw new ConflictException('Setup already completed');
      }

      const [{ total }] = await tx.select({ total: count() }).from(schema.users);
      if (Number(total) > 0) {
        throw new ConflictException('Setup already completed');
      }

      const existingUsername = await tx.query.users.findFirst({
        where: eq(sql`lower(${schema.users.username})`, dto.username.toLowerCase()),
      });
      if (existingUsername) {
        throw new ConflictException('Username already taken');
      }

      const existingEmail = await tx.query.users.findFirst({
        where: eq(sql`lower(${schema.users.email})`, dto.email.toLowerCase()),
      });
      if (existingEmail) {
        throw new ConflictException('Email already in use');
      }

      const [user] = await tx
        .insert(schema.users)
        .values({
          username: dto.username,
          name: dto.name,
          email: dto.email,
          passwordHash,
          isDefaultPassword: false,
          isSuperuser: true,
        })
        .returning({
          id: schema.users.id,
          username: schema.users.username,
          tokenVersion: schema.users.tokenVersion,
        });

      this.logger.log(`[auth.setup] [end] userId=${user.id} username=${user.username} isSuperuser=true - setup completed`);
      return user;
    });

    return this.issueTokensForUser(created.id, reply);
  }

  async login(dto: LoginDto, reply: FastifyReply, ip?: string) {
    const user = await this.userService.findByUsername(dto.username);
    const now = new Date();

    if (user?.lockedUntil && user.lockedUntil > now) {
      this.logger.warn(
        `[auth.login] [fail] userId=${user.id} username=${dto.username} ip=${ip ?? 'unknown'} errorClass=UnauthorizedException error="account locked" - login failed`,
      );
      this.auditEvents.emit(AUDIT_EVENT, {
        userId: user.id,
        actorUsername: user.username,
        action: AuditAction.AuthLoginFailed,
        description: `Failed login attempt for username '${dto.username}'`,
        ip,
        meta: { attemptedUsername: dto.username, lockout: true, lockedUntil: user.lockedUntil.toISOString() },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordHash = user?.passwordHash ?? DUMMY_HASH;
    const isPasswordValid = await compare(dto.password, passwordHash);
    if (!user || !user.active || !isPasswordValid) {
      const lockedUntil = user && user.active ? await this.recordFailedLoginAttempt(user.id, user.failedLoginAttempts ?? 0, now) : null;
      this.logger.warn(
        `[auth.login] [fail]${user ? ` userId=${user.id}` : ''} username=${dto.username} ip=${ip ?? 'unknown'} errorClass=UnauthorizedException error="${lockedUntil ? 'account locked' : 'invalid credentials'}" - login failed`,
      );
      this.auditEvents.emit(AUDIT_EVENT, {
        userId: user?.id ?? null,
        actorUsername: user?.username ?? 'system',
        action: AuditAction.AuthLoginFailed,
        description: `Failed login attempt for username '${dto.username}'`,
        ip,
        meta: lockedUntil
          ? { attemptedUsername: dto.username, lockout: true, lockedUntil: lockedUntil.toISOString() }
          : { attemptedUsername: dto.username },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    if ((user.failedLoginAttempts ?? 0) > 0 || user.lockedUntil) {
      await this.db.update(schema.users).set({ failedLoginAttempts: 0, lockedUntil: null }).where(eq(schema.users.id, user.id));
    }

    const fullUser = await this.userService.findByIdWithPermissions(user.id);
    const { accessToken, rawRefreshToken } = await this.issueTokenPair(user.id, user.tokenVersion);
    this.setRefreshCookie(reply, rawRefreshToken);
    this.setAccessCookie(reply, accessToken);

    this.logger.log(`[auth.login] [end] userId=${user.id} username=${user.username} ip=${ip ?? 'unknown'} - login completed`);

    this.auditEvents.emit(AUDIT_EVENT, {
      userId: user.id,
      actorUsername: user.username,
      action: AuditAction.AuthLogin,
      description: `User '${user.username}' logged in`,
      ip,
    });

    return { accessToken, user: this.buildUserResponse(fullUser!) };
  }

  buildUserResponse(user: RequestUser) {
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      active: user.active,
      isSuperuser: user.isSuperuser,
      isDefaultPassword: user.isDefaultPassword,
      settings: user.settings,
      avatarUrl: resolveUserAvatarUrl(user),
      provisioningMethod: user.provisioningMethod,
      permissions: user.isSuperuser ? ['*'] : user.permissions,
    };
  }

  async issueTokensForUser(userId: number, reply: FastifyReply) {
    const user = await this.userService.findByIdWithPermissions(userId);
    if (!user || !user.active) throw new UnauthorizedException();
    const { accessToken, rawRefreshToken, refreshExpiresAt } = await this.issueTokenPair(userId, user.tokenVersion);
    await this.oidcSessionRepo.touchActiveByUserId(userId, refreshExpiresAt);
    this.setRefreshCookie(reply, rawRefreshToken);
    this.setAccessCookie(reply, accessToken);
    return { accessToken, user: this.buildUserResponse(user) };
  }

  async refresh(req: FastifyRequest, reply: FastifyReply) {
    const rawToken = req.cookies?.refresh_token;
    if (!rawToken) throw new UnauthorizedException();

    const tokenHash = sha256(rawToken);
    const row = await this.db.query.refreshTokens.findFirst({
      where: eq(schema.refreshTokens.tokenHash, tokenHash),
    });

    if (!row) {
      this.logger.warn('[auth.refresh] [fail] errorClass=UnauthorizedException error="token not found" - refresh failed');
      throw new UnauthorizedException();
    }

    if (row.revokedAt) {
      if (await this.isRecentRefreshRotationReuse(row)) {
        return this.issueAccessOnlyForRefreshReuse(row.userId, reply);
      }

      // Reuse of a revoked token outside a fresh rotation indicates possible theft.
      // Revoke refresh sessions and bump tokenVersion to invalidate active access tokens.
      this.logger.warn(
        `[auth.refresh] [fail] userId=${row.userId} errorClass=UnauthorizedException error="token revoked - reuse attempt" - refresh failed`,
      );
      await this.db.transaction(async (tx) => {
        await tx
          .update(schema.users)
          .set({ tokenVersion: sql`${schema.users.tokenVersion} + 1` })
          .where(eq(schema.users.id, row.userId));
        await tx.delete(schema.refreshTokens).where(eq(schema.refreshTokens.userId, row.userId));
      });
      this.clearRefreshCookie(reply);
      this.clearAccessCookie(reply);
      throw new UnauthorizedException();
    }

    if (row.expiresAt < new Date()) {
      this.logger.warn(`[auth.refresh] [fail] userId=${row.userId} errorClass=UnauthorizedException error="token expired" - refresh failed`);
      this.clearRefreshCookie(reply);
      throw new UnauthorizedException();
    }

    const userForToken = await this.assertUserCanRefresh(row.userId, reply);

    // Rotate: revoke old, issue new. Guard against the SPA race where two requests
    // present the same (still-valid) refresh: the loser's UPDATE matches zero rows
    // and we treat it as a benign reuse of an already-rotated token.
    const { accessToken, rawRefreshToken, refreshExpiresAt, refreshTokenHash } = this.createTokenPair(row.userId, userForToken.tokenVersion);

    const rotatedAt = new Date();
    try {
      await this.db.transaction(async (tx) => {
        const updateResult = await tx
          .update(schema.refreshTokens)
          .set({ revokedAt: rotatedAt, rotatedAt, replacedByTokenHash: refreshTokenHash })
          .where(and(eq(schema.refreshTokens.id, row.id), isNull(schema.refreshTokens.revokedAt)));
        if ((updateResult.rowCount ?? 0) === 0) {
          throw new ConcurrentRotationError();
        }
        await tx.insert(schema.refreshTokens).values({ userId: row.userId, tokenHash: refreshTokenHash, expiresAt: refreshExpiresAt });
        await tx
          .update(schema.users)
          .set({ lastAuthenticatedAt: rotatedAt, updatedAt: sql`${schema.users.updatedAt}` })
          .where(eq(schema.users.id, row.userId));
      });
    } catch (err) {
      if (err instanceof ConcurrentRotationError) {
        // rowCount=0 only proves "someone else changed this row first" - it could be a
        // concurrent rotation OR a concurrent logout/security revoke. Re-fetch and only
        // accept the race as benign if the revoke came from rotation. Otherwise the user
        // (or admin) explicitly killed this session and we must NOT resurrect it.
        const refreshedRow = await this.db.query.refreshTokens.findFirst({
          where: eq(schema.refreshTokens.id, row.id),
        });
        if (refreshedRow && (await this.isRecentRefreshRotationReuse(refreshedRow))) {
          this.logger.log(`[auth.refresh] [end] userId=${row.userId} reason="rotation-race-lost" - access-only refresh issued`);
          return this.issueAccessOnlyForRefreshReuse(row.userId, reply);
        }
        // Concurrent non-rotation revoke = the user (logout) or an admin (disable/security)
        // just killed this specific session. Honor that intent: fail this refresh and clear
        // cookies, but do NOT touch other devices' sessions (logout deliberately only revoked
        // this token; admin actions have their own scope).
        this.logger.warn(
          `[auth.refresh] [fail] userId=${row.userId} errorClass=UnauthorizedException error="concurrent non-rotation revoke" - refresh failed`,
        );
        this.clearRefreshCookie(reply);
        this.clearAccessCookie(reply);
        throw new UnauthorizedException();
      }
      throw err;
    }
    // touchActive must run outside the transaction (oidc sessions are best-effort sliding TTL).
    await this.oidcSessionRepo.touchActiveByUserId(row.userId, refreshExpiresAt);
    this.setRefreshCookie(reply, rawRefreshToken);
    this.setAccessCookie(reply, accessToken);

    return { accessToken };
  }

  async logout(req: FastifyRequest, reply: FastifyReply): Promise<{ logoutUrl?: string }> {
    let userId: number | undefined;

    const rawToken: string | undefined = req.cookies?.refresh_token;
    if (rawToken) {
      const tokenHash = sha256(rawToken);
      const row = await this.db.query.refreshTokens.findFirst({ where: eq(schema.refreshTokens.tokenHash, tokenHash) });
      if (row) {
        userId = row.userId;
        this.logger.log(`[auth.logout] [end] userId=${row.userId} source=refresh_token - logout completed`);
        await Promise.all([
          this.userService.incrementTokenVersion(row.userId),
          this.db.update(schema.refreshTokens).set({ revokedAt: new Date() }).where(eq(schema.refreshTokens.id, row.id)),
        ]);
      }
    }

    this.clearRefreshCookie(reply);
    this.clearAccessCookie(reply);

    if (userId) {
      const loggedOutUser = await this.db.query.users.findFirst({ where: eq(schema.users.id, userId) });
      if (loggedOutUser) {
        this.auditEvents.emit(AUDIT_EVENT, {
          userId,
          actorUsername: loggedOutUser.username,
          action: AuditAction.AuthLogout,
          description: `User '${loggedOutUser.username}' logged out`,
          ip: req.ip,
        });
      }
    }

    if (!userId) return {};

    const oidcSession = await this.oidcSessionRepo.findActiveByUserId(userId);
    if (!oidcSession) return {};

    await this.oidcSessionRepo.revokeByUserId(userId);
    if (!oidcSession.idTokenHint) return {};

    const oidcLogoutStart = Date.now();
    try {
      let issuerUri: string;
      if (oidcSession.providerId) {
        const provider = await this.db.query.oidcProviders.findFirst({ where: eq(schema.oidcProviders.id, oidcSession.providerId) });
        if (!provider?.enabled) return {};
        issuerUri = provider.issuerUri;
      } else {
        const oidcConfig = await this.appSettings.getOidcConfig();
        if (!oidcConfig.enabled) return {};
        issuerUri = oidcSession.oidcIssuer;
      }

      const disc = await this.oidcDiscovery.getDiscoveryDoc(issuerUri);
      if (!disc.endSessionEndpoint) return {};

      const origin = req.headers['origin'] ?? req.headers['referer'];
      const postLogoutUri = origin ? new URL('/login', origin).toString() : undefined;

      const params = new URLSearchParams({ id_token_hint: oidcSession.idTokenHint });
      if (postLogoutUri) params.set('post_logout_redirect_uri', postLogoutUri);

      return { logoutUrl: `${disc.endSessionEndpoint}?${params.toString()}` };
    } catch (error) {
      const durationMs = Date.now() - oidcLogoutStart;
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      const errorMessage = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(
        `[auth.logout] [fail] userId=${userId} durationMs=${durationMs} errorClass=${errorClass} error="${errorMessage}" - oidc logout url generation failed`,
      );
      return {};
    }
  }

  async validateUser(userId: number, tokenVersion: number) {
    const user = await this.userService.findByIdWithPermissions(userId);
    if (!user || !user.active) throw new UnauthorizedException();
    if (user.tokenVersion !== tokenVersion) throw new UnauthorizedException();

    if (user.provisioningMethod === 'shared') {
      const hasActive = await this.magicLinkRepo.hasActiveByUserId(userId);
      if (!hasActive) throw new UnauthorizedException();
    }

    return user;
  }

  async revokeAllUserSessions(userId: number) {
    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.users)
        .set({ tokenVersion: sql`${schema.users.tokenVersion} + 1` })
        .where(eq(schema.users.id, userId));
      await tx
        .update(schema.refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(schema.refreshTokens.userId, userId), isNull(schema.refreshTokens.revokedAt)));
    });
  }

  async getSessions(userId: number) {
    const rows = await this.db.query.refreshTokens.findMany({
      where: and(eq(schema.refreshTokens.userId, userId), isNull(schema.refreshTokens.revokedAt), gt(schema.refreshTokens.expiresAt, new Date())),
    });
    return rows.map(({ id, createdAt, expiresAt }) => ({ id, createdAt, expiresAt }));
  }

  async revokeSession(userId: number, sessionId: number) {
    const row = await this.db.query.refreshTokens.findFirst({
      where: eq(schema.refreshTokens.id, sessionId),
    });
    if (!row) throw new NotFoundException('Session not found');
    if (row.userId !== userId) throw new ForbiddenException('You do not have access to this session');
    await this.db.update(schema.refreshTokens).set({ revokedAt: new Date() }).where(eq(schema.refreshTokens.id, sessionId));
  }

  async forgotPassword(dto: ForgotPasswordDto, ip?: string): Promise<void> {
    if (!(await this.systemMailService.isConfigured())) {
      throw new ServiceUnavailableException('Self-service password reset is not configured. Contact your administrator.');
    }
    void this.processPasswordResetAsync(dto.email, ip).catch((err) => this.logger.error('Unhandled error during password reset processing', err));
  }

  private async processPasswordResetAsync(email: string, ip?: string): Promise<void> {
    const user = await this.userService.findByEmail(email);
    if (!user || !user.email) {
      this.logger.log(`Password reset requested for unknown email: ${maskEmail(email)}`);
      return;
    }

    if (!user.active) {
      this.logger.log(`Password reset requested for inactive account: ${maskEmail(email)}`);
      return;
    }

    if (user.provisioningMethod === 'oidc') {
      this.logger.log(`Password reset requested for OIDC account: ${maskEmail(email)}`);
      return;
    }

    if (user.provisioningMethod === 'shared') {
      this.logger.log(`Password reset requested for shared account: ${maskEmail(email)}`);
      return;
    }

    const rawToken = await this.userService.generatePasswordResetToken(user.id);
    await this.systemMailService.sendPasswordReset(user.email, user.name, rawToken);

    this.auditEvents.emit(AUDIT_EVENT, {
      userId: user.id,
      actorUsername: user.username,
      action: AuditAction.AuthPasswordResetRequest,
      description: `Password reset email sent to ${user.email}`,
      ip,
    });
  }

  async resetPassword(dto: ResetPasswordDto, ip?: string): Promise<void> {
    const tokenHash = sha256(dto.token);

    const row = await this.db.query.passwordResetTokens.findFirst({
      where: eq(schema.passwordResetTokens.tokenHash, tokenHash),
    });

    if (!row || row.expiresAt < new Date() || row.usedAt) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const user = await this.db.query.users.findFirst({ where: eq(schema.users.id, row.userId) });
    if (!user || !user.active || user.provisioningMethod === 'oidc' || user.provisioningMethod === 'shared') {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const passwordHash = await hash(dto.newPassword, 12);

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.users)
        .set({ passwordHash, isDefaultPassword: false, tokenVersion: sql`${schema.users.tokenVersion} + 1` })
        .where(eq(schema.users.id, row.userId));

      await tx.update(schema.passwordResetTokens).set({ usedAt: new Date() }).where(eq(schema.passwordResetTokens.id, row.id));

      await tx
        .update(schema.refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(schema.refreshTokens.userId, row.userId), isNull(schema.refreshTokens.revokedAt)));
    });

    this.auditEvents.emit(AUDIT_EVENT, {
      userId: user.id,
      actorUsername: user.username,
      action: AuditAction.AuthPasswordReset,
      description: `Password reset completed for user '${user.username}'`,
      ip,
    });
  }

  async changePassword(userId: number, dto: ChangePasswordDto, reply: FastifyReply, ip?: string) {
    const user = await this.db.query.users.findFirst({
      where: eq(schema.users.id, userId),
    });
    if (!user) throw new UnauthorizedException();

    if (user.provisioningMethod === 'oidc') {
      throw new BadRequestException('OIDC accounts cannot change their password here');
    }

    if (user.provisioningMethod === 'shared') {
      throw new BadRequestException('Shared accounts cannot change their password');
    }

    const valid = await compare(dto.currentPassword, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Current password is incorrect');

    const passwordHash = await hash(dto.newPassword, 12);

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.users)
        .set({ passwordHash, isDefaultPassword: false, tokenVersion: sql`${schema.users.tokenVersion} + 1` })
        .where(eq(schema.users.id, userId));

      await tx
        .update(schema.refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(schema.refreshTokens.userId, userId), isNull(schema.refreshTokens.revokedAt)));
    });

    this.clearRefreshCookie(reply);
    this.clearAccessCookie(reply);

    this.auditEvents.emit(AUDIT_EVENT, {
      userId,
      actorUsername: user.username,
      action: AuditAction.AuthPasswordChange,
      description: `User '${user.username}' changed their password`,
      ip,
    });
  }

  getRefreshTokenExpiryDate(baseDate = new Date()) {
    return new Date(baseDate.getTime() + parseDurationMs(this.config.get<string>('auth.jwtRefreshExpiresIn') ?? '7d'));
  }

  private async issueTokenPair(userId: number, tokenVersion: number) {
    const pair = this.createTokenPair(userId, tokenVersion);
    const authenticatedAt = new Date();

    await this.db.transaction(async (tx) => {
      await tx.insert(schema.refreshTokens).values({ userId, tokenHash: pair.refreshTokenHash, expiresAt: pair.refreshExpiresAt });
      await tx
        .update(schema.users)
        .set({ lastLoginAt: authenticatedAt, lastAuthenticatedAt: authenticatedAt, updatedAt: sql`${schema.users.updatedAt}` })
        .where(eq(schema.users.id, userId));
    });

    return pair;
  }

  private createTokenPair(userId: number, tokenVersion: number) {
    const accessToken = this.jwtService.sign({ sub: userId, ver: tokenVersion });

    const rawRefreshToken = randomBytes(32).toString('hex');
    const tokenHash = sha256(rawRefreshToken);
    const expiresAt = this.getRefreshTokenExpiryDate();

    return { accessToken, rawRefreshToken, refreshExpiresAt: expiresAt, refreshTokenHash: tokenHash };
  }

  private getRefreshRotationGraceMs(): number {
    return this.config.get<number>('auth.refreshRotationGraceMs') ?? 30_000;
  }

  /**
   * Distinguishes a benign rotation race (or a chained rotation) from refresh-token theft.
   *
   * Accepts the presented (revoked) token only when:
   *   - it was revoked by rotation (rotatedAt + replacedByTokenHash set)
   *   - the rotation happened within the configured grace window
   *   - walking the rotation chain (up to ROTATION_CHAIN_MAX_HOPS) reaches a live row
   *     for the same user. A revoked link in the chain is OK only if it was itself rotated
   *     (so we don't resurrect a session that was explicitly logged out).
   */
  private async isRecentRefreshRotationReuse(row: typeof schema.refreshTokens.$inferSelect) {
    if (!row.rotatedAt || !row.replacedByTokenHash) return false;
    if (row.expiresAt < new Date()) return false;
    const elapsedMs = Date.now() - row.rotatedAt.getTime();
    if (elapsedMs < 0 || elapsedMs > this.getRefreshRotationGraceMs()) return false;

    let nextHash: string | null = row.replacedByTokenHash;
    for (let hop = 0; hop < ROTATION_CHAIN_MAX_HOPS && nextHash; hop++) {
      const next: typeof schema.refreshTokens.$inferSelect | undefined = await this.db.query.refreshTokens.findFirst({
        where: eq(schema.refreshTokens.tokenHash, nextHash),
      });
      if (!next || next.userId !== row.userId || next.expiresAt < new Date()) return false;
      if (!next.revokedAt) return true;
      // Revoked-but-rotated link: keep walking. Revoked-without-rotation means logout/security revoke.
      if (!next.rotatedAt || !next.replacedByTokenHash) return false;
      nextHash = next.replacedByTokenHash;
    }
    return false;
  }

  private async assertUserCanRefresh(userId: number, reply: FastifyReply) {
    const userForToken = await this.db.query.users.findFirst({ where: eq(schema.users.id, userId) });
    if (!userForToken) throw new UnauthorizedException();
    if (!userForToken.active) {
      this.logger.warn(`[auth.refresh] [fail] userId=${userId} errorClass=UnauthorizedException error="account disabled" - refresh failed`);
      this.clearRefreshCookie(reply);
      this.clearAccessCookie(reply);
      throw new UnauthorizedException('Account disabled');
    }
    if (userForToken.provisioningMethod === 'shared') {
      const hasActive = await this.magicLinkRepo.hasActiveByUserId(userId);
      if (!hasActive) {
        this.logger.warn(`[auth.refresh] [fail] userId=${userId} errorClass=UnauthorizedException error="all magic links revoked" - refresh failed`);
        await this.revokeAllUserSessions(userId);
        this.clearRefreshCookie(reply);
        this.clearAccessCookie(reply);
        throw new UnauthorizedException();
      }
    }
    return userForToken;
  }

  private async issueAccessOnlyForRefreshReuse(userId: number, reply: FastifyReply) {
    const userForToken = await this.assertUserCanRefresh(userId, reply);
    const accessToken = this.jwtService.sign({ sub: userId, ver: userForToken.tokenVersion });
    await this.db
      .update(schema.users)
      .set({ lastAuthenticatedAt: new Date(), updatedAt: sql`${schema.users.updatedAt}` })
      .where(eq(schema.users.id, userId));
    this.setAccessCookie(reply, accessToken);
    this.logger.log(`[auth.refresh] [end] userId=${userId} reason="rotation-race" - access-only refresh issued`);
    return { accessToken };
  }

  private assertSetupToken(setupToken: string | undefined) {
    const isDevelopment = this.config.get<string>('app.nodeEnv') === 'development';
    if (isDevelopment) return;

    const expected = this.config.get<string>('auth.setupBootstrapToken') ?? '';
    const inputDigest = Buffer.from(sha256(setupToken ?? ''), 'hex');
    const expectedDigest = Buffer.from(sha256(expected), 'hex');
    if (!timingSafeEqual(inputDigest, expectedDigest)) {
      throw new ForbiddenException('Invalid setup token');
    }
  }

  private async recordFailedLoginAttempt(userId: number, currentFailedAttempts: number, now: Date): Promise<Date | null> {
    const nextFailedAttempts = currentFailedAttempts + 1;
    const lockedUntil = nextFailedAttempts >= LOGIN_LOCKOUT_THRESHOLD ? new Date(now.getTime() + LOGIN_LOCKOUT_DURATION_MS) : null;

    await this.db
      .update(schema.users)
      .set({
        failedLoginAttempts: lockedUntil ? 0 : nextFailedAttempts,
        lockedUntil,
      })
      .where(eq(schema.users.id, userId));

    return lockedUntil;
  }

  private setRefreshCookie(reply: FastifyReply, rawToken: string) {
    const ttlSeconds = parseDurationMs(this.config.get<string>('auth.jwtRefreshExpiresIn') ?? '7d') / 1000;

    reply.setCookie('refresh_token', rawToken, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/api/v1/auth',
      maxAge: ttlSeconds,
      secure: 'auto',
    });
  }

  private clearRefreshCookie(reply: FastifyReply) {
    reply.setCookie('refresh_token', '', {
      httpOnly: true,
      sameSite: 'strict',
      path: '/api/v1/auth',
      maxAge: 0,
      secure: 'auto',
    });
  }

  private setAccessCookie(reply: FastifyReply, accessToken: string) {
    const ttlSeconds = parseDurationMs(this.config.get<string>('auth.jwtExpiresIn') ?? '15m') / 1000;
    reply.setCookie('access_token', accessToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/api',
      maxAge: ttlSeconds,
      secure: 'auto',
    });
  }

  private clearAccessCookie(reply: FastifyReply) {
    reply.setCookie('access_token', '', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/api',
      maxAge: 0,
      secure: 'auto',
    });
  }
}
