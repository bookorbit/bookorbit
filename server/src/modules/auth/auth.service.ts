import { AuthSessionRepository, type OidcSessionInput } from './auth-session.repository';
import { AuthSessionService } from './auth-session.service';
import { RefreshDto } from './dto/refresh.dto';
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
import { compare, hash } from 'bcryptjs';
import { createHash, timingSafeEqual } from 'crypto';
import '@fastify/cookie';
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { AuditAction, AuthenticationMethod, LoginErrorCode } from '@bookorbit/types';
import type { AuthenticationMethod as AuthenticationMethodValue, AuthClientOptions, NativeCredentials, LoginOptionsResponse } from '@bookorbit/types';

import { APP_SETTING_KEYS } from '../../common/constants/app-settings.constants';
import { DB } from '../../db/db.module';
import * as schema from '../../db/schema';
import { AUDIT_EVENT, AuditEventsService } from '../audit/audit-events.service';
import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { resolveUserAvatarUrl } from '../../common/utils/user-avatar-url';
import { SystemMailService } from '../email/system-mail.service';
import { UserService } from '../user/user.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SetupDto } from './dto/setup.dto';
import { MagicLinkRepository } from './magic-link.repository';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { OidcProviderService } from '../app-settings/oidc-provider.service';
import { AuthenticationPolicyService } from '../../common/services/authentication-policy.service';

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
const DUMMY_HASH = '$2a$12$LJ3m4ys3Lk0TSwHBbqP8b.3bFfR1oVDMhPzX8KPrPeuMEJBJJPa.G';

function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***@${email.slice(at + 1)}`;
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const directCode = (error as { code?: unknown }).code;
  if (directCode === '23505') return true;

  if (!(error instanceof Error)) return false;
  return (error.cause as { code?: unknown } | undefined)?.code === '23505';
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly userService: UserService,
    private readonly config: ConfigService,
    private readonly systemMailService: SystemMailService,
    private readonly auditEvents: AuditEventsService,
    private readonly magicLinkRepo: MagicLinkRepository,
    private readonly appSettings: AppSettingsService,
    private readonly oidcProviderService: OidcProviderService,
    private readonly authenticationPolicy: AuthenticationPolicyService,
    private readonly sessions: AuthSessionService,
    private readonly sessionRepo: AuthSessionRepository,
    @Inject(DB) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  private async isRegistrationOpen(): Promise<boolean> {
    return (await this.appSettings.getValue(APP_SETTING_KEYS.ALLOW_REGISTRATION)) === 'true';
  }

  async register(dto: RegisterDto) {
    this.authenticationPolicy.assertPasswordLoginEnabled();
    if (!(await this.isRegistrationOpen())) {
      throw new ForbiddenException('Registration is not open');
    }

    const defaultLibraryIds = await this.appSettings.getDefaultLibraryAccessLibraryIds();
    const passwordHash = await hash(dto.password, 12);
    try {
      return await this.registerInTransaction(dto, passwordHash, defaultLibraryIds);
    } catch (error) {
      // Two concurrent signups for the same identifier pass the pre-checks and collide on the
      // lower(username)/lower(email) unique indexes; report the loser as a conflict, not a 500.
      if (isUniqueViolation(error)) throw new ConflictException('Registration failed');
      throw error;
    }
  }

  private registerInTransaction(dto: RegisterDto, passwordHash: string, defaultLibraryIds: number[]) {
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

      this.logger.log(`[auth.register] [end] userId=${user.id} username="${sanitizeLogValue(user.username)}" - registration completed`);

      this.auditEvents.emit(AUDIT_EVENT, {
        userId: user.id,
        actorUsername: user.username,
        action: AuditAction.AuthRegister,
        description: `User '${user.username}' registered`,
      });

      return user;
    });
  }

  async setupStatus(): Promise<{ needsSetup: boolean; allowRegistration: boolean }> {
    const [count, allowRegistration] = await Promise.all([this.db.$count(schema.users), this.isRegistrationOpen()]);
    return { needsSetup: count === 0, allowRegistration: this.authenticationPolicy.isPasswordLoginEnabled() && allowRegistration };
  }

  async loginOptions(): Promise<LoginOptionsResponse> {
    const [allowRegistration, providers] = await Promise.all([this.isRegistrationOpen(), this.oidcProviderService.findEnabled()]);
    const passwordLoginEnabled = this.authenticationPolicy.isPasswordLoginEnabled();
    return {
      passwordLoginEnabled,
      allowRegistration: passwordLoginEnabled && allowRegistration,
      oidcProviders: providers.map((provider) => ({
        slug: provider.slug,
        displayName: provider.displayName,
        enabled: provider.enabled,
        iconUrl: provider.iconUrl,
        clientId: provider.clientId,
        scopes: provider.scopes,
      })),
    };
  }

  async setup(dto: SetupDto, setupToken: string | undefined, reply: FastifyReply) {
    this.authenticationPolicy.assertPasswordLoginEnabled();
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

    return this.issueTokensForUser(created.id, reply, AuthenticationMethod.Setup);
  }

  async login(dto: LoginDto, reply: FastifyReply, ip?: string) {
    this.authenticationPolicy.assertPasswordLoginEnabled();
    const user = await this.userService.findByUsername(dto.username);
    const now = new Date();

    const isLockedOut = Boolean(user?.lockedUntil && user.lockedUntil > now);

    // The lockout is reported only to someone who supplied the correct password, so an attacker
    // probing usernames still gets the generic failure and learns nothing about which accounts exist.
    const passwordHash = user?.passwordHash ?? DUMMY_HASH;
    const isPasswordValid = await compare(dto.password, passwordHash);
    if (!user || !user.active || !isPasswordValid) {
      const newlyLockedUntil =
        user && user.active && !isLockedOut ? await this.recordFailedLoginAttempt(user.id, user.failedLoginAttempts ?? 0, now) : null;
      const lockedUntil = newlyLockedUntil ?? (isLockedOut ? (user?.lockedUntil ?? null) : null);
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

    if (isLockedOut && user.lockedUntil) {
      const retryAfterSeconds = Math.max(1, Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 1000));
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
      throw new UnauthorizedException({
        message: 'Account temporarily locked after too many failed sign-in attempts',
        errorCode: LoginErrorCode.ACCOUNT_LOCKED,
        retryAfterSeconds,
      });
    }

    if ((user.failedLoginAttempts ?? 0) > 0 || user.lockedUntil) {
      await this.db.update(schema.users).set({ failedLoginAttempts: 0, lockedUntil: null }).where(eq(schema.users.id, user.id));
    }

    const fullUser = await this.userService.findByIdWithPermissions(user.id);
    const credentials = await this.sessions.issue(user.id, user.tokenVersion, AuthenticationMethod.Password, dto);

    this.logger.log(`[auth.login] [end] userId=${user.id} username=${user.username} ip=${ip ?? 'unknown'} - login completed`);

    this.auditEvents.emit(AUDIT_EVENT, {
      userId: user.id,
      actorUsername: user.username,
      action: AuditAction.AuthLogin,
      description: `User '${user.username}' logged in`,
      ip,
    });

    return {
      ...this.deliverCredentials(credentials, reply, dto.clientKind === 'native'),
      user: this.buildUserResponse(fullUser!, AuthenticationMethod.Password),
    };
  }

  buildUserResponse(user: RequestUser, authenticationMethod: AuthenticationMethodValue = user.authenticationMethod ?? AuthenticationMethod.Legacy) {
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
      authenticationMethod,
      permissions: user.isSuperuser ? ['*'] : user.permissions,
    };
  }

  async issueTokensForUser(
    userId: number,
    reply: FastifyReply,
    authenticationMethod: AuthenticationMethodValue,
    options: AuthClientOptions = {},
    oidc?: OidcSessionInput,
  ) {
    const user = await this.userService.findByIdWithPermissions(userId);
    if (!user || !user.active) throw new UnauthorizedException();
    const credentials = await this.sessions.issue(userId, user.tokenVersion, authenticationMethod, options, oidc);
    return {
      ...this.deliverCredentials(credentials, reply, options.clientKind === 'native'),
      user: this.buildUserResponse(user, authenticationMethod),
    };
  }

  private refreshCredential(req: FastifyRequest, dto: RefreshDto) {
    const cookie = req.cookies?.refresh_token;
    if (dto.refreshToken && cookie && dto.refreshToken !== cookie) throw new BadRequestException('Conflicting refresh credentials');
    return { rawToken: dto.refreshToken ?? cookie, native: !!dto.refreshToken };
  }

  async refresh(req: FastifyRequest, reply: FastifyReply, dto: RefreshDto = {}) {
    const { rawToken, native } = this.refreshCredential(req, dto);
    try {
      if (!rawToken) throw new UnauthorizedException();
      const row = await this.sessionRepo.findRefresh(sha256(rawToken));
      if (!row?.sessionId) throw new UnauthorizedException();
      const session = await this.sessionRepo.findSession(row.sessionId);
      if (!session || (session.clientKind === 'native') !== native) throw new UnauthorizedException();
      const method = this.normalizeAuthenticationMethod(row.authenticationMethod);
      if (!this.isAuthenticationMethodAllowed(method)) {
        await this.sessionRepo.revoke(row.sessionId, row.userId);
        throw new UnauthorizedException();
      }
      const user = await this.userService.findByIdWithPermissions(row.userId);
      if (!user?.active || !(await this.canActNow(user))) throw new UnauthorizedException();
      const credentials = await this.sessions.refresh(rawToken, row.userId, user.tokenVersion, row.sessionId);
      return this.deliverCredentials(credentials, reply, native);
    } catch (error) {
      if (!native && error instanceof UnauthorizedException) {
        this.clearRefreshCookie(reply);
        this.clearAccessCookie(reply);
      }
      throw error;
    }
  }

  async logout(req: FastifyRequest, reply: FastifyReply, dto: RefreshDto = {}): Promise<Record<string, never>> {
    const { rawToken, native } = this.refreshCredential(req, dto);
    if (rawToken) {
      const row = await this.sessionRepo.findRefresh(sha256(rawToken));
      if (row?.sessionId) {
        const session = await this.sessionRepo.findSession(row.sessionId);
        if (session && (session.clientKind === 'native') === native) {
          await this.sessionRepo.revoke(row.sessionId, row.userId);
          const user = await this.userService.findByIdWithPermissions(row.userId);
          if (user)
            this.auditEvents.emit(AUDIT_EVENT, {
              userId: row.userId,
              actorUsername: user.username,
              action: AuditAction.AuthLogout,
              description: `User '${user.username}' logged out`,
              ip: req.ip,
            });
        }
      }
    }
    if (!native) {
      this.clearRefreshCookie(reply);
      this.clearAccessCookie(reply);
    }
    return {};
  }

  private deliverCredentials(credentials: NativeCredentials, reply: FastifyReply, native: boolean) {
    reply.header('Cache-Control', 'no-store');
    if (native) return credentials;
    this.setRefreshCookie(reply, credentials.refreshToken, new Date(credentials.refreshTokenExpiresAt));
    this.setAccessCookie(reply, credentials.accessToken);
    const { accessToken, accessTokenExpiresAt, sessionId } = credentials;
    return { accessToken, accessTokenExpiresAt, sessionId };
  }

  async validateSessionUser(userId: number, tokenVersion: number, authenticationMethod: AuthenticationMethodValue, sessionId?: number) {
    if (!Number.isSafeInteger(sessionId) || !sessionId || sessionId < 1) throw new UnauthorizedException();
    if (!(await this.sessionRepo.isActive(sessionId, userId, tokenVersion, authenticationMethod))) throw new UnauthorizedException();
    const user = await this.validateUser(userId, tokenVersion, authenticationMethod);
    return { ...user, sessionId };
  }

  async validateUser(userId: number, tokenVersion: number, authenticationMethod: AuthenticationMethodValue) {
    if (!this.isAuthenticationMethodAllowed(authenticationMethod)) throw new UnauthorizedException();
    const user = await this.userService.findByIdWithPermissions(userId);
    if (!user || !user.active) throw new UnauthorizedException();
    // Before the shared-link lookup, so a stale token is refused without a second query.
    if (user.tokenVersion !== tokenVersion) throw new UnauthorizedException();
    if (!(await this.canActNow(user))) throw new UnauthorizedException();

    return { ...user, authenticationMethod };
  }

  /**
   * The user as an authenticated request would have resolved them, for a caller acting on their
   * behalf rather than as them.
   *
   * Everything `validateUser` checks except the token version, which belongs to a token this
   * caller does not hold. Null rather than a throw, because the refusal a delegated call should
   * give is not the one a bad token gives, and only the caller knows which it is making.
   */
  async findActingUser(userId: number): Promise<RequestUser | null> {
    const user = await this.userService.findByIdWithPermissions(userId);
    if (!user || !user.active) return null;
    return (await this.canActNow(user)) ? user : null;
  }

  /**
   * A shared account exists only for as long as a live magic link points at it, so a revoked link
   * has to close every door and not just the login form.
   */
  private async canActNow(user: RequestUser): Promise<boolean> {
    if (user.provisioningMethod !== 'shared') return true;
    return this.magicLinkRepo.hasActiveByUserId(user.id);
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

  getSessions(userId: number) {
    return this.sessionRepo.list(userId);
  }

  async revokeSession(userId: number, sessionId: number) {
    const row = await this.sessionRepo.findSession(sessionId);
    if (!row) throw new NotFoundException('Session not found');
    if (row.userId !== userId) throw new ForbiddenException('You do not have access to this session');
    await this.sessionRepo.revoke(sessionId, userId);
  }

  async forgotPassword(dto: ForgotPasswordDto, ip?: string): Promise<void> {
    this.authenticationPolicy.assertPasswordLoginEnabled();
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
    this.authenticationPolicy.assertPasswordLoginEnabled();
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
        .set({
          passwordHash,
          isDefaultPassword: false,
          tokenVersion: sql`${schema.users.tokenVersion} + 1`,
          failedLoginAttempts: 0,
          lockedUntil: null,
        })
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
    this.authenticationPolicy.assertPasswordLoginEnabled();
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
        .set({
          passwordHash,
          isDefaultPassword: false,
          tokenVersion: sql`${schema.users.tokenVersion} + 1`,
          failedLoginAttempts: 0,
          lockedUntil: null,
        })
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

  private normalizeAuthenticationMethod(value: string): AuthenticationMethodValue {
    return Object.values(AuthenticationMethod).includes(value as AuthenticationMethodValue)
      ? (value as AuthenticationMethodValue)
      : AuthenticationMethod.Legacy;
  }

  private isAuthenticationMethodAllowed(authenticationMethod: AuthenticationMethodValue): boolean {
    if (this.authenticationPolicy.isPasswordLoginEnabled()) return true;
    return authenticationMethod === AuthenticationMethod.Oidc || authenticationMethod === AuthenticationMethod.MagicLink;
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

  private setRefreshCookie(reply: FastifyReply, rawToken: string, expiresAt: Date) {
    const ttlSeconds = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));

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
