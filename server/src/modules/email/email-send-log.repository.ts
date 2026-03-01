import { Inject, Injectable } from '@nestjs/common';
import { and, eq, lte, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { emailSendLog } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class EmailSendLogRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  insert(values: typeof emailSendLog.$inferInsert) {
    return this.db.insert(emailSendLog).values(values).returning();
  }

  findById(id: number) {
    return this.db.select().from(emailSendLog).where(eq(emailSendLog.id, id)).limit(1);
  }

  findForUser(userId: number, limit: number, offset: number) {
    return this.db
      .select()
      .from(emailSendLog)
      .where(eq(emailSendLog.userId, userId))
      .orderBy(sql`${emailSendLog.createdAt} desc`)
      .limit(limit)
      .offset(offset);
  }

  findAll(limit: number, offset: number) {
    return this.db
      .select()
      .from(emailSendLog)
      .orderBy(sql`${emailSendLog.createdAt} desc`)
      .limit(limit)
      .offset(offset);
  }

  findPendingRetries(now: Date) {
    return this.db
      .select()
      .from(emailSendLog)
      .where(and(eq(emailSendLog.status, 'pending'), lte(emailSendLog.nextRetryAt, now)));
  }

  markSent(id: number) {
    return this.db
      .update(emailSendLog)
      .set({ status: 'sent', sentAt: sql`now()`, errorMessage: null, updatedAt: sql`now()` })
      .where(eq(emailSendLog.id, id))
      .returning();
  }

  markFailed(id: number, errorMessage: string, nextRetryAt: Date | null) {
    return this.db
      .update(emailSendLog)
      .set({
        status: nextRetryAt ? 'pending' : 'failed',
        errorMessage,
        nextRetryAt,
        attemptCount: sql`${emailSendLog.attemptCount} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(emailSendLog.id, id))
      .returning();
  }

  markAbandoned(id: number) {
    return this.db
      .update(emailSendLog)
      .set({
        status: 'failed',
        errorMessage: 'Server restarted before send completed. Use resend to retry.',
        nextRetryAt: null,
        updatedAt: sql`now()`,
      })
      .where(eq(emailSendLog.id, id))
      .returning();
  }

  delete(id: number, userId: number) {
    return this.db
      .delete(emailSendLog)
      .where(and(eq(emailSendLog.id, id), eq(emailSendLog.userId, userId)))
      .returning();
  }
}
