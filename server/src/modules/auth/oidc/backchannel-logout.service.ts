import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull, lt } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db/db.module';
import * as schema from '../../../db/schema';
import { OidcProviderService } from '../../app-settings/oidc-provider.service';
import { UserService } from '../../user/user.service';
import { OidcDiscoveryService } from './oidc-discovery.service';
import { OidcSessionRepository } from './oidc-session.repository';
import { OidcTokenValidatorService } from './oidc-token-validator.service';

type Db = NodePgDatabase<typeof schema>;

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}

@Injectable()
export class BackchannelLogoutService {
  private readonly logger = new Logger(BackchannelLogoutService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly providerService: OidcProviderService,
    private readonly discovery: OidcDiscoveryService,
    private readonly tokenValidator: OidcTokenValidatorService,
    private readonly sessionRepo: OidcSessionRepository,
    private readonly userService: UserService,
  ) {}

  async handleLogout(logoutToken: string): Promise<void> {
    // D2: Decode JWT without verification to find the issuer
    const unverified = decodeJwtPayload(logoutToken);
    if (!unverified?.iss) {
      this.logger.warn('[auth.oidc_backchannel_logout] [fail] error="cannot decode logout token issuer" - backchannel logout rejected');
      return;
    }

    const issuerRaw = unverified.iss;
    if (typeof issuerRaw !== 'string') {
      this.logger.warn('[auth.oidc_backchannel_logout] [fail] error="cannot decode logout token issuer" - backchannel logout rejected');
      return;
    }

    const issuer = issuerRaw;
    const provider = await this.providerService.findByIssuerUri(issuer);
    if (!provider || !provider.enabled) {
      this.logger.warn(`[auth.oidc_backchannel_logout] [fail] issuer=${issuer} error="no matching enabled provider" - backchannel logout rejected`);
      return;
    }

    const discovery = await this.discovery.getDiscoveryDoc(provider.issuerUri);

    const claims = await this.tokenValidator.validateLogoutToken(logoutToken, {
      issuer: discovery.issuer,
      clientId: provider.clientId,
      jwksUri: discovery.jwksUri,
    });

    // Replay prevention via DB
    if (claims.jti) {
      const jti = typeof claims.jti === 'string' ? claims.jti : undefined;
      if (jti) {
        const expiresAt = claims.exp ? new Date(claims.exp * 1000) : new Date(Date.now() + 3_600_000);

        const inserted = await this.db.insert(schema.oidcUsedJtis).values({ jti, expiresAt }).onConflictDoNothing().returning();

        if (inserted.length === 0) {
          this.logger.warn(
            '[auth.oidc_backchannel_logout] [fail] errorClass=UnauthorizedException error="logout token jti replay" - backchannel logout rejected',
          );
          return;
        }

        await this.db.delete(schema.oidcUsedJtis).where(lt(schema.oidcUsedJtis.expiresAt, new Date()));
      }
    }

    const subject = String(claims.sub ?? '');
    const rawSid = claims['sid'];
    const sid = typeof rawSid === 'string' ? rawSid : undefined;

    let userId: number | undefined;

    if (sid) {
      const session = await this.sessionRepo.findActiveBySid(sid);
      if (session) {
        userId = session.userId;
        await this.sessionRepo.revokeBySid(sid);
      }
    }

    if (!userId && subject) {
      const sessions = await this.sessionRepo.findActiveBySubjectAndIssuer(subject, discovery.issuer);
      if (sessions.length > 0) {
        userId = sessions[0].userId;
        await this.sessionRepo.revokeBySubjectAndIssuer(subject, discovery.issuer);
      }
    }

    if (!userId) {
      this.logger.warn(
        `[auth.oidc_backchannel_logout] [fail] subject=${subject} sid=${sid ?? 'none'} errorClass=UnauthorizedException error="no active oidc session" - backchannel logout skipped`,
      );
      return;
    }

    await this.db
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.refreshTokens.userId, userId), isNull(schema.refreshTokens.revokedAt)));

    await this.userService.incrementTokenVersion(userId);

    this.logger.log(`[auth.oidc_backchannel_logout] [end] userId=${userId} - backchannel logout completed`);
  }
}
