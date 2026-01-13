import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db/db.module';
import * as schema from '../../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class OidcSessionRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async create(data: typeof schema.oidcSessions.$inferInsert) {
    const [session] = await this.db.insert(schema.oidcSessions).values(data).returning();
    return session;
  }

  async findActiveBySid(sid: string) {
    return this.db.query.oidcSessions.findFirst({
      where: and(eq(schema.oidcSessions.oidcSessionId, sid), eq(schema.oidcSessions.revoked, false)),
    });
  }

  async findActiveBySubjectAndIssuer(subject: string, issuer: string) {
    return this.db.query.oidcSessions.findMany({
      where: and(eq(schema.oidcSessions.oidcSubject, subject), eq(schema.oidcSessions.oidcIssuer, issuer), eq(schema.oidcSessions.revoked, false)),
    });
  }

  async revokeBySid(sid: string) {
    await this.db.update(schema.oidcSessions).set({ revoked: true }).where(eq(schema.oidcSessions.oidcSessionId, sid));
  }

  async revokeBySubjectAndIssuer(subject: string, issuer: string) {
    await this.db
      .update(schema.oidcSessions)
      .set({ revoked: true })
      .where(and(eq(schema.oidcSessions.oidcSubject, subject), eq(schema.oidcSessions.oidcIssuer, issuer)));
  }

  async findActiveByUserId(userId: number) {
    return this.db.query.oidcSessions.findFirst({
      where: and(eq(schema.oidcSessions.userId, userId), eq(schema.oidcSessions.revoked, false)),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });
  }

  async revokeByUserId(userId: number) {
    await this.db.update(schema.oidcSessions).set({ revoked: true }).where(eq(schema.oidcSessions.userId, userId));
  }
}
