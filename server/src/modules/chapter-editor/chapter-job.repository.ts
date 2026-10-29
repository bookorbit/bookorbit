import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookChapterJobs } from '../../db/schema';
import type { BookChapterJobKind, BookChapterJobState } from '@bookorbit/types';

@Injectable()
export class ChapterJobRepository {
  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async enqueue(bookId: number, userId: number, kind: BookChapterJobKind, baseRevision: string, retry = false): Promise<BookChapterJobState> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(1120, 1)`);
      const [existing] = await tx
        .select()
        .from(bookChapterJobs)
        .where(
          and(
            eq(bookChapterJobs.bookId, bookId),
            eq(bookChapterJobs.userId, userId),
            eq(bookChapterJobs.kind, kind),
            eq(bookChapterJobs.baseRevision, baseRevision),
          ),
        )
        .limit(1);
      const freshRead = existing?.status === 'success' && kind === 'read';
      if (existing && !freshRead && (!retry || existing.status !== 'failed')) return this.state(existing);
      const [count] = await tx
        .select({ total: sql<number>`count(*)::int`, mine: sql<number>`count(*) FILTER (WHERE user_id = ${userId})::int` })
        .from(bookChapterJobs)
        .where(sql`status IN ('queued', 'processing')`);
      if (count.total >= 128 || count.mine >= 16) throw new ConflictException('Too many chapter operations are waiting');
      if (existing) {
        const [requeued] = await tx
          .update(bookChapterJobs)
          .set({ status: 'queued', result: null, errorCode: null, filesWritten: 0, filesTotal: 0, updatedAt: new Date() })
          .where(eq(bookChapterJobs.id, existing.id))
          .returning();
        return this.state(requeued);
      }
      await tx
        .delete(bookChapterJobs)
        .where(and(sql`status IN ('success', 'failed')`, lt(bookChapterJobs.updatedAt, new Date(Date.now() - 7 * 86_400_000))));
      const [job] = await tx.insert(bookChapterJobs).values({ bookId, userId, kind, baseRevision }).returning();
      return this.state(job);
    });
  }

  async find(bookId: number, userId: number, id: string): Promise<BookChapterJobState | null> {
    const [job] = await this.db
      .select()
      .from(bookChapterJobs)
      .where(and(eq(bookChapterJobs.id, id), eq(bookChapterJobs.bookId, bookId), eq(bookChapterJobs.userId, userId)))
      .limit(1);
    return job ? this.state(job) : null;
  }

  async latest(bookId: number, userId: number): Promise<BookChapterJobState | null> {
    const [job] = await this.db
      .select()
      .from(bookChapterJobs)
      .where(and(eq(bookChapterJobs.bookId, bookId), eq(bookChapterJobs.userId, userId)))
      .orderBy(desc(bookChapterJobs.updatedAt), desc(bookChapterJobs.id))
      .limit(1);
    return job ? this.state(job) : null;
  }

  async recover(): Promise<void> {
    // Remux is not replayed automatically: a process crash may follow a successful disk replacement.
    await this.db
      .update(bookChapterJobs)
      .set({ status: 'failed', errorCode: 'book_chapters_operation_interrupted', updatedAt: new Date() })
      .where(eq(bookChapterJobs.status, 'processing'));
  }

  async claim() {
    const result = await this.db.execute<{ id: string }>(sql`UPDATE book_chapter_jobs SET status = 'processing', updated_at = now()
      WHERE id = (SELECT id FROM book_chapter_jobs WHERE status = 'queued' ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id`);
    if (!result.rows[0]) return null;
    const [job] = await this.db.select().from(bookChapterJobs).where(eq(bookChapterJobs.id, result.rows[0].id));
    return job;
  }

  async progress(id: string, filesWritten: number, filesTotal: number): Promise<void> {
    await this.db.update(bookChapterJobs).set({ filesWritten, filesTotal, updatedAt: new Date() }).where(eq(bookChapterJobs.id, id));
  }

  async finish(id: string, result: BookChapterJobState['result'], errorCode?: string): Promise<void> {
    await this.db
      .update(bookChapterJobs)
      .set({ status: errorCode ? 'failed' : 'success', result: result ?? null, errorCode: errorCode ?? null, updatedAt: new Date() })
      .where(eq(bookChapterJobs.id, id));
  }

  private state(job: typeof bookChapterJobs.$inferSelect): BookChapterJobState {
    return {
      id: job.id,
      kind: job.kind,
      status: job.status,
      filesWritten: job.filesWritten,
      filesTotal: job.filesTotal,
      result: job.result ?? undefined,
      errorCode: job.errorCode ?? undefined,
    };
  }
}
