import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DB } from '../../db/db.module';
import * as schema from '../../db/schema';

export type OidcSessionInput = Omit<typeof schema.oidcSessions.$inferInsert, 'userId' | 'sessionId' | 'expiresAt'>;

type SessionRow = typeof schema.authSessions.$inferSelect;
type RefreshRow = typeof schema.refreshTokens.$inferSelect;
type ExchangeResult = { session: SessionRow; refresh: RefreshRow; tokenIndex: number } | null;

@Injectable()
export class AuthSessionRepository {
  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async create(data: typeof schema.authSessions.$inferInsert, tokenHash: string, oidc?: OidcSessionInput) {
    return this.db.transaction(async (tx) => {
      const [user] = await tx
        .select({ active: schema.users.active, tokenVersion: schema.users.tokenVersion })
        .from(schema.users)
        .where(eq(schema.users.id, data.userId))
        .for('update');
      if (!user?.active || user.tokenVersion !== data.tokenVersion) return null;
      const [session] = await tx.insert(schema.authSessions).values(data).returning();
      await tx.insert(schema.refreshTokens).values({
        userId: session.userId,
        sessionId: session.id,
        tokenHash,
        authenticationMethod: session.authenticationMethod,
        expiresAt: session.expiresAt,
      });
      if (oidc) await tx.insert(schema.oidcSessions).values({ ...oidc, userId: session.userId, sessionId: session.id, expiresAt: session.expiresAt });
      await tx
        .update(schema.users)
        .set({ lastLoginAt: new Date(), lastAuthenticatedAt: new Date(), updatedAt: sql`${schema.users.updatedAt}` })
        .where(eq(schema.users.id, data.userId));
      return session;
    });
  }

  findRefresh(tokenHash: string) {
    return this.db.query.refreshTokens.findFirst({ where: eq(schema.refreshTokens.tokenHash, tokenHash) });
  }

  findSession(id: number) {
    return this.db.query.authSessions.findFirst({ where: eq(schema.authSessions.id, id) });
  }

  async isActive(id: number, userId: number, tokenVersion: number, authenticationMethod: string) {
    const [row] = await this.db
      .select({ id: schema.authSessions.id })
      .from(schema.authSessions)
      .where(
        and(
          eq(schema.authSessions.id, id),
          eq(schema.authSessions.userId, userId),
          eq(schema.authSessions.tokenVersion, tokenVersion),
          eq(schema.authSessions.authenticationMethod, authenticationMethod),
          isNull(schema.authSessions.revokedAt),
          gt(schema.authSessions.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return !!row;
  }

  async exchange(params: {
    sessionId: number;
    userId: number;
    tokenVersion: number;
    tokenHashes: string[];
    expiresAt: Date;
    now: Date;
    graceMs: number;
  }): Promise<ExchangeResult> {
    const { sessionId, userId, tokenVersion, tokenHashes, expiresAt, now, graceMs } = params;
    return this.db.transaction(async (tx) => {
      // Account security changes lock the user first. Use the same order for issuance/rotation.
      const [user] = await tx
        .select({ active: schema.users.active, tokenVersion: schema.users.tokenVersion })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .for('update');
      const [session] = await tx
        .select()
        .from(schema.authSessions)
        .where(and(eq(schema.authSessions.id, sessionId), eq(schema.authSessions.userId, userId)))
        .for('update');
      if (
        !user?.active ||
        user.tokenVersion !== tokenVersion ||
        !session ||
        session.tokenVersion !== tokenVersion ||
        session.revokedAt ||
        session.expiresAt <= now
      )
        return null;

      const rows = await tx
        .select()
        .from(schema.refreshTokens)
        .where(and(eq(schema.refreshTokens.sessionId, sessionId), inArray(schema.refreshTokens.tokenHash, tokenHashes)));
      const byHash = new Map(rows.map((row) => [row.tokenHash, row]));
      const presented = byHash.get(tokenHashes[0]);
      if (!presented || presented.expiresAt <= now) return null;
      if (!presented.revokedAt) {
        await tx
          .update(schema.refreshTokens)
          .set({ revokedAt: now, rotatedAt: now, replacedByTokenHash: tokenHashes[1] })
          .where(eq(schema.refreshTokens.id, presented.id));
        const [refresh] = await tx
          .insert(schema.refreshTokens)
          .values({
            userId,
            sessionId,
            tokenHash: tokenHashes[1],
            expiresAt,
            authenticationMethod: session.authenticationMethod,
          })
          .returning();
        await tx.update(schema.authSessions).set({ expiresAt }).where(eq(schema.authSessions.id, sessionId));
        await tx
          .update(schema.oidcSessions)
          .set({ expiresAt })
          .where(and(eq(schema.oidcSessions.sessionId, sessionId), eq(schema.oidcSessions.revoked, false)));
        await tx
          .update(schema.users)
          .set({ lastAuthenticatedAt: now, updatedAt: sql`${schema.users.updatedAt}` })
          .where(eq(schema.users.id, userId));
        return { session: { ...session, expiresAt }, refresh, tokenIndex: 1 };
      }

      let current = presented;
      for (let index = 1; index < tokenHashes.length; index++) {
        const elapsed = current.rotatedAt ? now.getTime() - current.rotatedAt.getTime() : -1;
        if (!current.revokedAt || elapsed < 0 || elapsed > graceMs || current.replacedByTokenHash !== tokenHashes[index]) break;
        const next = byHash.get(tokenHashes[index]);
        if (!next || next.expiresAt <= now || next.userId !== userId || next.authenticationMethod !== session.authenticationMethod) break;
        if (!next.revokedAt) return { session, refresh: next, tokenIndex: index };
        current = next;
      }

      await tx.update(schema.authSessions).set({ revokedAt: now }).where(eq(schema.authSessions.id, sessionId));
      await tx
        .update(schema.refreshTokens)
        .set({ revokedAt: now })
        .where(and(eq(schema.refreshTokens.sessionId, sessionId), isNull(schema.refreshTokens.revokedAt)));
      await tx.update(schema.oidcSessions).set({ revoked: true }).where(eq(schema.oidcSessions.sessionId, sessionId));
      return null;
    });
  }

  async revoke(id: number, userId: number) {
    await this.db.transaction(async (tx) => {
      const [session] = await tx
        .update(schema.authSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(schema.authSessions.id, id), eq(schema.authSessions.userId, userId)))
        .returning({ id: schema.authSessions.id });
      if (!session) return;
      await tx
        .update(schema.refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(schema.refreshTokens.sessionId, id), isNull(schema.refreshTokens.revokedAt)));
      await tx.update(schema.oidcSessions).set({ revoked: true }).where(eq(schema.oidcSessions.sessionId, id));
    });
  }

  async list(userId: number) {
    return this.db
      .select({
        id: schema.authSessions.id,
        clientKind: schema.authSessions.clientKind,
        deviceLabel: schema.authSessions.deviceLabel,
        authenticationMethod: schema.authSessions.authenticationMethod,
        createdAt: schema.authSessions.createdAt,
        expiresAt: schema.authSessions.expiresAt,
      })
      .from(schema.authSessions)
      .innerJoin(schema.users, eq(schema.users.id, schema.authSessions.userId))
      .where(
        and(
          eq(schema.authSessions.userId, userId),
          isNull(schema.authSessions.revokedAt),
          gt(schema.authSessions.expiresAt, new Date()),
          eq(schema.authSessions.tokenVersion, schema.users.tokenVersion),
        ),
      )
      .orderBy(desc(schema.authSessions.id))
      .limit(100);
  }
}
