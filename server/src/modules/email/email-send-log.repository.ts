import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, getTableColumns, gt, gte, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authors, bookAuthors, bookFiles, bookMetadata, emailRecipients, emailSendLog } from '../../db/schema';
import { EMAIL_SEND_STATUS_FAILED, EMAIL_SEND_STATUS_PENDING, EMAIL_SEND_STATUS_SENT } from './email-send.constants';

type Db = NodePgDatabase<typeof schema>;

export interface EmailLogFilter {
  bookId?: number;
  status?: string;
  recipientId?: number;
}

@Injectable()
export class EmailSendLogRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  insert(values: typeof emailSendLog.$inferInsert) {
    return this.db.insert(emailSendLog).values(values).returning();
  }

  findById(id: number) {
    return this.db.select().from(emailSendLog).where(eq(emailSendLog.id, id)).limit(1);
  }

  /** Each row plus the book title and the file that went out, so a history can name what was sent. */
  private selectWithBook() {
    return this.db
      .select({
        ...getTableColumns(emailSendLog),
        bookTitle: bookMetadata.title,
        bookAuthors: sql<
          string | null
        >`(select string_agg(${authors.name}, ', ' order by ${bookAuthors.displayOrder}, ${authors.id}) from ${bookAuthors} inner join ${authors} on ${authors.id} = ${bookAuthors.authorId} where ${bookAuthors.bookId} = ${emailSendLog.bookId})`,
        fileFormat: bookFiles.format,
        fileSizeBytes: bookFiles.sizeBytes,
      })
      .from(emailSendLog)
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, emailSendLog.bookId))
      .leftJoin(bookFiles, eq(bookFiles.id, emailSendLog.bookFileId));
  }

  findForUser(userId: number, limit: number, offset: number, { bookId, status, recipientId }: EmailLogFilter = {}) {
    const conditions = [eq(emailSendLog.userId, userId)];
    if (bookId !== undefined) conditions.push(eq(emailSendLog.bookId, bookId));
    if (status !== undefined) conditions.push(eq(emailSendLog.status, status));
    if (recipientId !== undefined) {
      // Rows logged before recipient_id existed carry only the address; the subquery is scoped to the caller.
      conditions.push(sql`(${emailSendLog.recipientId} = ${recipientId} or (${emailSendLog.recipientId} is null and lower(${emailSendLog.toEmail}) = (
        select lower(${emailRecipients.email}) from ${emailRecipients} where ${emailRecipients.id} = ${recipientId} and ${emailRecipients.userId} = ${userId}
      )))`);
    }
    return this.selectWithBook()
      .where(and(...conditions))
      .orderBy(desc(emailSendLog.createdAt), desc(emailSendLog.id))
      .limit(limit)
      .offset(offset);
  }

  async countForUser(userId: number) {
    const [row] = await this.db
      .select({
        total: count(),
        failed: count(sql`case when ${emailSendLog.status} = ${EMAIL_SEND_STATUS_FAILED} then 1 end`),
        pending: count(sql`case when ${emailSendLog.status} = ${EMAIL_SEND_STATUS_PENDING} then 1 end`),
      })
      .from(emailSendLog)
      .where(eq(emailSendLog.userId, userId));
    return row ?? { total: 0, failed: 0, pending: 0 };
  }

  /**
   * Failed sends since a moment that nothing has replaced: no later send of the same book to the
   * same address exists, whatever its outcome, so a resent book drops out on its own.
   */
  findUnresolvedFailures(userId: number, since: Date, limit: number) {
    return this.selectWithBook()
      .where(
        and(
          eq(emailSendLog.userId, userId),
          eq(emailSendLog.status, EMAIL_SEND_STATUS_FAILED),
          gte(emailSendLog.createdAt, since),
          sql`not exists (
            select 1 from ${emailSendLog} as later
            where later.user_id = ${emailSendLog.userId}
              and later.book_id is not distinct from ${emailSendLog.bookId}
              and lower(later.to_email) = lower(${emailSendLog.toEmail})
              and later.created_at > ${emailSendLog.createdAt}
          )`,
        ),
      )
      .orderBy(desc(emailSendLog.createdAt))
      .limit(limit);
  }

  /**
   * The newest send to each of the user's recipients, with its book title. Rows logged before
   * recipient_id existed are matched by address instead.
   */
  async findLastSendPerRecipient(userId: number) {
    const result = await this.db.execute<{
      recipient_id: number;
      book_id: number | null;
      status: string;
      created_at: Date | string;
      attempt_count: number;
      failure_code: string | null;
      error_message: string | null;
      book_title: string | null;
    }>(sql`
      select r.id as recipient_id, last.book_id, last.status, last.created_at, last.attempt_count, last.failure_code, last.error_message,
        bm.title as book_title
      from email_recipients r
      join lateral (
        select l.book_id, l.status, l.created_at, l.attempt_count, l.failure_code, l.error_message
        from email_send_log l
        where l.user_id = r.user_id
          and (l.recipient_id = r.id or (l.recipient_id is null and lower(l.to_email) = lower(r.email)))
        order by l.created_at desc, l.id desc
        limit 1
      ) last on true
      left join book_metadata bm on bm.book_id = last.book_id
      where r.user_id = ${userId}
    `);
    return result.rows.map((row) => ({
      recipientId: Number(row.recipient_id),
      bookId: row.book_id === null ? null : Number(row.book_id),
      bookTitle: row.book_title,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString(),
      attemptCount: Number(row.attempt_count),
      failureCode: row.failure_code,
      errorMessage: row.error_message,
    }));
  }

  findAll(limit: number, offset: number) {
    return this.db
      .select()
      .from(emailSendLog)
      .orderBy(sql`${emailSendLog.createdAt} desc`)
      .limit(limit)
      .offset(offset);
  }

  findPending(afterId = 0) {
    return this.db
      .select()
      .from(emailSendLog)
      .where(and(eq(emailSendLog.status, EMAIL_SEND_STATUS_PENDING), gt(emailSendLog.id, afterId)))
      .orderBy(emailSendLog.id)
      .limit(100);
  }

  updateDelivery(id: number, patch: Partial<typeof emailSendLog.$inferInsert>) {
    return this.db.update(emailSendLog).set(patch).where(eq(emailSendLog.id, id)).returning();
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
        errorMessage: 'Server restarted before send completed. SMTP acceptance may be unknown. Review before resending.',
        failureCode: 'SEND_INTERRUPTED',
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
