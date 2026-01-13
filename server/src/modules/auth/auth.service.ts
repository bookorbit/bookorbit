import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import '@fastify/cookie';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { DB } from '../../db/db.module';
import * as schema from '../../db/schema';
import type { RequestUser } from '../../common/types/request-user';
import { MailerService } from '../../common/services/mailer.service';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { UserService } from '../user/user.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { OidcDiscoveryService } from './oidc/oidc-discovery.service';
import { OidcSessionRepository } from './oidc/oidc-session.repository';

function parseDurationMs(duration: string): number {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid duration: ${duration}`);
  const n = parseInt(match[1], 10);
  const units: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return n * units[match[2]];
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly mailerService: MailerService,
    private readonly appSettings: AppSettingsService,
    private readonly oidcSessionRepo: OidcSessionRepository,
    private readonly oidcDiscovery: OidcDiscoveryService,
    @Inject(DB) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async register(dto: RegisterDto) {
    const setting = await this.db.query.appSettings.findFirst({
      where: eq(schema.appSettings.key, 'allow_registration'),
    });
    if (setting?.value !== 'true') {
      throw new ForbiddenException('Registration is not open');
    }

    const existingUsername = await this.userService.findByUsername(dto.username);
    if (existingUsername) throw new ConflictException('Username already taken');

    if (dto.email) {
      const existingEmail = await this.userService.findByEmail(dto.email);
      if (existingEmail) throw new ConflictException('Email already in use');
    }

    const passwordHash = await hash(dto.password, 12);
    const user = await this.userService.create({
      username: dto.username,
      name: dto.name,
      email: dto.email,
      passwordHash,
      isDefaultPassword: false,
    });

    const userRole = await this.db.query.roles.findFirst({
      where: eq(schema.roles.name, 'User'),
    });
    if (userRole) {
      await this.db.insert(schema.userRoles).values({ userId: user.id, roleId: userRole.id });
    } else {
      this.logger.warn(`User role not found — registered user ${user.username} has no role`);
    }

    return { id: user.id, username: user.username, name: user.name };
  }

  async login(dto: LoginDto, reply: FastifyReply) {
    const user = await this.userService.findByUsername(dto.username);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    if (!user.active) throw new UnauthorizedException('Account disabled');

    const valid = await compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const fullUser = await this.userService.findByIdWithRolesAndPermissions(user.id);
    const { accessToken, rawRefreshToken } = await this.issueTokenPair(user.id, user.tokenVersion);
    this.setRefreshCookie(reply, rawRefreshToken);

    return { accessToken, user: this.buildUserResponse(fullUser!) };
  }

  buildUserResponse(user: RequestUser) {
    const isSuperuser = user.roles.some((r) => r.isSuperuser);
    const permissions = isSuperuser ? ['*'] : [...new Set(user.roles.flatMap((r) => r.permissions.map((p) => p.name)))];
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      active: user.active,
      isDefaultPassword: user.isDefaultPassword,
      settings: user.settings,
      avatarUrl: user.avatarUrl,
      provisioningMethod: user.provisioningMethod,
      roles: user.roles.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        isSuperuser: r.isSuperuser,
        isSystem: r.isSystem,
        permissions: r.permissions.map((p) => ({ id: p.id, name: p.name })),
      })),
      permissions,
    };
  }

  async issueTokensForUser(userId: number, reply: FastifyReply) {
    const user = await this.userService.findByIdWithRolesAndPermissions(userId);
    if (!user || !user.active) throw new UnauthorizedException();
    const { accessToken, rawRefreshToken } = await this.issueTokenPair(userId, user.tokenVersion);
    this.setRefreshCookie(reply, rawRefreshToken);
    return { accessToken, user: this.buildUserResponse(user) };
  }

  async refresh(req: FastifyRequest, reply: FastifyReply) {
    const rawToken = req.cookies?.refresh_token;
    if (!rawToken) throw new UnauthorizedException();

    const tokenHash = sha256(rawToken);
    const row = await this.db.query.refreshTokens.findFirst({
      where: eq(schema.refreshTokens.tokenHash, tokenHash),
    });

    if (!row) throw new UnauthorizedException();

    // Reuse of a revoked token → theft signal, revoke all user sessions
    if (row.revokedAt) {
      await this.db.delete(schema.refreshTokens).where(eq(schema.refreshTokens.userId, row.userId));
      this.clearRefreshCookie(reply);
      throw new UnauthorizedException();
    }

    if (row.expiresAt < new Date()) {
      this.clearRefreshCookie(reply);
      throw new UnauthorizedException();
    }

    // Rotate: revoke old, issue new
    await this.db.update(schema.refreshTokens).set({ revokedAt: new Date() }).where(eq(schema.refreshTokens.id, row.id));

    const userForToken = await this.db.query.users.findFirst({ where: eq(schema.users.id, row.userId) });
    if (!userForToken) throw new UnauthorizedException();

    const { accessToken, rawRefreshToken } = await this.issueTokenPair(row.userId, userForToken.tokenVersion);
    this.setRefreshCookie(reply, rawRefreshToken);

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
        await Promise.all([
          this.userService.incrementTokenVersion(row.userId),
          this.db.update(schema.refreshTokens).set({ revokedAt: new Date() }).where(eq(schema.refreshTokens.id, row.id)),
        ]);
      }
    }

    this.clearRefreshCookie(reply);

    if (!userId) return {};

    const oidcSession = await this.oidcSessionRepo.findActiveByUserId(userId);
    if (!oidcSession?.idTokenHint) return {};

    try {
      const config = await this.appSettings.getOidcConfig();
      if (!config.enabled) return {};

      const disc = await this.oidcDiscovery.getDiscoveryDoc(config.issuerUri);
      if (!disc.endSessionEndpoint) return {};

      const origin = (req.headers['origin'] as string | undefined) ?? (req.headers['referer'] as string | undefined);
      const postLogoutUri = origin ? new URL('/login', origin).toString() : undefined;

      const params = new URLSearchParams({ id_token_hint: oidcSession.idTokenHint });
      if (postLogoutUri) params.set('post_logout_redirect_uri', postLogoutUri);

      await this.oidcSessionRepo.revokeByUserId(userId);

      return { logoutUrl: `${disc.endSessionEndpoint}?${params.toString()}` };
    } catch {
      return {};
    }
  }

  async validateUser(userId: number, tokenVersion: number) {
    const user = await this.userService.findByIdWithRolesAndPermissions(userId);
    if (!user || !user.active) throw new UnauthorizedException();
    if (user.tokenVersion !== tokenVersion) throw new UnauthorizedException();
    return user;
  }

  async getSessions(userId: number) {
    const rows = await this.db.query.refreshTokens.findMany({
      where: and(eq(schema.refreshTokens.userId, userId), isNull(schema.refreshTokens.revokedAt)),
    });
    return rows.filter((r) => r.expiresAt > new Date()).map(({ id, createdAt, expiresAt }) => ({ id, createdAt, expiresAt }));
  }

  async revokeSession(userId: number, sessionId: number) {
    const row = await this.db.query.refreshTokens.findFirst({
      where: eq(schema.refreshTokens.id, sessionId),
    });
    if (!row || row.userId !== userId) throw new UnauthorizedException();
    await this.db.update(schema.refreshTokens).set({ revokedAt: new Date() }).where(eq(schema.refreshTokens.id, sessionId));
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    if (!this.mailerService.isConfigured()) {
      throw new ServiceUnavailableException('Self-service password reset is not configured. Contact your administrator.');
    }

    // Always return without revealing whether email exists
    const user = await this.userService.findByEmail(dto.email);
    if (!user || !user.email) return;

    const rawToken = await this.userService.generatePasswordResetToken(user.id);
    await this.mailerService.sendPasswordReset(user.email, user.name, rawToken);
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const tokenHash = sha256(dto.token);

    const row = await this.db.query.passwordResetTokens.findFirst({
      where: eq(schema.passwordResetTokens.tokenHash, tokenHash),
    });

    if (!row || row.expiresAt < new Date() || row.usedAt) {
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
  }

  async changePassword(userId: number, dto: ChangePasswordDto, reply: FastifyReply) {
    const user = await this.db.query.users.findFirst({
      where: eq(schema.users.id, userId),
    });
    if (!user) throw new UnauthorizedException();

    if (user.provisioningMethod === 'oidc') {
      throw new BadRequestException('OIDC accounts cannot change their password here');
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
  }

  private async issueTokenPair(userId: number, tokenVersion: number) {
    const accessToken = this.jwtService.sign({ sub: userId, ver: tokenVersion });

    const rawRefreshToken = randomBytes(32).toString('hex');
    const tokenHash = sha256(rawRefreshToken);
    const refreshTtlMs = parseDurationMs(this.config.get<string>('auth.jwtRefreshExpiresIn') ?? '7d');
    const expiresAt = new Date(Date.now() + refreshTtlMs);

    await this.db.insert(schema.refreshTokens).values({ userId, tokenHash, expiresAt });

    return { accessToken, rawRefreshToken };
  }

  private setRefreshCookie(reply: FastifyReply, rawToken: string) {
    const ttlSeconds = parseDurationMs(this.config.get<string>('auth.jwtRefreshExpiresIn') ?? '7d') / 1000;

    reply.setCookie('refresh_token', rawToken, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/api/auth',
      maxAge: ttlSeconds,
      secure: this.config.get('app.nodeEnv') === 'production',
    });
  }

  private clearRefreshCookie(reply: FastifyReply) {
    reply.setCookie('refresh_token', '', {
      httpOnly: true,
      sameSite: 'strict',
      path: '/api/auth',
      maxAge: 0,
      secure: this.config.get('app.nodeEnv') === 'production',
    });
  }
}
