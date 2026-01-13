import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db/db.module';
import * as schema from '../../../db/schema';
import { AppSettingsService } from '../../app-settings/app-settings.service';
import { UserService } from '../../user/user.service';
import { OidcDiscoveryService } from './oidc-discovery.service';
import { OidcSessionRepository } from './oidc-session.repository';
import { OidcTokenValidatorService } from './oidc-token-validator.service';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class BackchannelLogoutService {
  private readonly logger = new Logger(BackchannelLogoutService.name);
  // JTI replay prevention: jti -> expiry timestamp
  private readonly usedJtis = new Map<string, number>();

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly appSettings: AppSettingsService,
    private readonly discovery: OidcDiscoveryService,
    private readonly tokenValidator: OidcTokenValidatorService,
    private readonly sessionRepo: OidcSessionRepository,
    private readonly userService: UserService,
  ) {}

  async handleLogout(logoutToken: string): Promise<void> {
    const config = await this.appSettings.getOidcConfig();
    if (!config.enabled) return;

    const discovery = await this.discovery.getDiscoveryDoc(config.issuerUri);

    const claims = await this.tokenValidator.validateLogoutToken(logoutToken, {
      issuer: discovery.issuer,
      clientId: config.clientId,
      jwksUri: discovery.jwksUri,
    });

    // Replay prevention
    if (claims.jti) {
      if (this.usedJtis.has(claims.jti)) {
        this.logger.warn('Replay detected for logout token JTI');
        return;
      }
      const exp = claims.exp ? claims.exp * 1000 : Date.now() + 3_600_000;
      this.usedJtis.set(claims.jti, exp);

      // Prune expired JTIs
      const now = Date.now();
      for (const [jti, expiry] of this.usedJtis) {
        if (expiry < now) this.usedJtis.delete(jti);
      }
    }

    const subject = String(claims.sub ?? '');
    const sid = claims.sid ? String(claims.sid) : undefined;

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
      this.logger.warn(`Backchannel logout: no active OIDC session for sub=${subject} sid=${sid}`);
      return;
    }

    // Revoke all refresh tokens
    await this.db
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.refreshTokens.userId, userId), isNull(schema.refreshTokens.revokedAt)));

    // Invalidate all JWTs via token version bump
    await this.userService.incrementTokenVersion(userId);

    this.logger.log(`Backchannel logout: revoked all sessions for userId=${userId}`);
  }
}
