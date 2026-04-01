import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { emailSendLog } from '../../db/schema';
import { EMAIL_SEND_STATUS_FAILED, EMAIL_SEND_STATUS_PENDING, EMAIL_SEND_STATUS_SENT } from './email-send.constants';

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

  findPending() {
    return this.db.select().from(emailSendLog).where(eq(emailSendLog.status, EMAIL_SEND_STATUS_PENDING));
  }

  markSent(id: number) {
    return this.db
      .update(emailSendLog)
      .set({ status: EMAIL_SEND_STATUS_SENT, sentAt: sql`now()`, errorMessage: null, updatedAt: sql`now()` })
      .where(eq(emailSendLog.id, id))
      .returning();
  }

  markFailed(id: number, errorMessage: string, nextRetryAt: Date | null) {
    return this.db
      .update(emailSendLog)
      .set({
        status: nextRetryAt ? EMAIL_SEND_STATUS_PENDING : EMAIL_SEND_STATUS_FAILED,
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
        status: EMAIL_SEND_STATUS_FAILED,
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
