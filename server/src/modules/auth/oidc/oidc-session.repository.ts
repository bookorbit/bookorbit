import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DB } from '../../../db/db.module';
import * as schema from '../../../db/schema';

@Injectable()
export class OidcSessionRepository {
  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async revokeProviderSessions(issuer: string, selector: { sid: string } | { subject: string }) {
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const matching = tx
        .select({ id: schema.oidcSessions.sessionId })
        .from(schema.oidcSessions)
        .where(
          and(
            eq(schema.oidcSessions.oidcIssuer, issuer),
            eq(schema.oidcSessions.revoked, false),
            gt(schema.oidcSessions.expiresAt, now),
            'sid' in selector ? eq(schema.oidcSessions.oidcSessionId, selector.sid) : eq(schema.oidcSessions.oidcSubject, selector.subject),
          ),
        );
      // Lock application sessions before their OIDC rows, matching refresh and local logout.
      const result = await tx.update(schema.authSessions).set({ revokedAt: now }).where(inArray(schema.authSessions.id, matching));
      const revoked = tx
        .select({ id: schema.authSessions.id })
        .from(schema.authSessions)
        .where(and(inArray(schema.authSessions.id, matching), eq(schema.authSessions.revokedAt, now)));
      await tx
        .update(schema.refreshTokens)
        .set({ revokedAt: now })
        .where(and(inArray(schema.refreshTokens.sessionId, revoked), isNull(schema.refreshTokens.revokedAt)));
      await tx.update(schema.oidcSessions).set({ revoked: true }).where(inArray(schema.oidcSessions.sessionId, revoked));
      return result.rowCount ?? 0;
    });
  }
}
