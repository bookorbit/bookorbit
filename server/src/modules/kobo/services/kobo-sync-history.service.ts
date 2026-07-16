import { Inject, Injectable, Logger } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { KoboSyncHistoryCounts, KoboSyncHistoryEntry, KoboSyncHistoryEvent } from '@bookorbit/types';
import { DB } from '../../../db/db.module';
import * as schema from '../../../db/schema';
import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { KoboBookAccessService } from './kobo-book-access.service';

type Db = NodePgDatabase<typeof schema>;

const HISTORY_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 20;

interface RecordBaseInput {
  userId: number;
  deviceId: number;
  event: KoboSyncHistoryEvent;
  durationMs: number;
  counts?: KoboSyncHistoryCounts;
}

@Injectable()
export class KoboSyncHistoryService {
  private readonly logger = new Logger(KoboSyncHistoryService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly bookAccessService: KoboBookAccessService,
  ) {}

  async listForUser(userId: number, limit = DEFAULT_LIST_LIMIT): Promise<KoboSyncHistoryEntry[]> {
    const cappedLimit = Math.min(Math.max(Math.trunc(limit), 1), HISTORY_LIMIT);
    const rows = await this.db
      .select({
        id: schema.koboSyncHistory.id,
        deviceId: schema.koboSyncHistory.deviceId,
        deviceName: schema.koboDevices.name,
        event: schema.koboSyncHistory.event,
        status: schema.koboSyncHistory.status,
        counts: schema.koboSyncHistory.counts,
        durationMs: schema.koboSyncHistory.durationMs,
        errorClass: schema.koboSyncHistory.errorClass,
        error: schema.koboSyncHistory.error,
        createdAt: schema.koboSyncHistory.createdAt,
      })
      .from(schema.koboSyncHistory)
      .leftJoin(schema.koboDevices, eq(schema.koboDevices.id, schema.koboSyncHistory.deviceId))
      .where(eq(schema.koboSyncHistory.userId, userId))
      .orderBy(desc(schema.koboSyncHistory.createdAt), desc(schema.koboSyncHistory.id))
      .limit(cappedLimit);

    return rows.map((row) => ({
      id: row.id,
      deviceId: row.deviceId,
      deviceName: row.deviceName,
      event: row.event as KoboSyncHistoryEvent,
      status: row.status as KoboSyncHistoryEntry['status'],
      counts: this.asCounts(row.counts),
      durationMs: row.durationMs,
      errorClass: row.errorClass,
      error: row.error,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async recordSuccess(input: RecordBaseInput): Promise<void> {
    await this.record({
      ...input,
      status: 'success',
      errorClass: null,
      error: null,
    });
  }

  async recordFailure(input: RecordBaseInput, error: unknown): Promise<void> {
    const err = error instanceof Error ? error : new Error(String(error));
    await this.record({
      ...input,
      status: 'failed',
      errorClass: err.constructor.name,
      error: sanitizeLogValue(err.message, 500),
    });
  }

  async countsForBook(userId: number, bookId: number, counts: KoboSyncHistoryCounts = {}): Promise<KoboSyncHistoryCounts> {
    let bookTitle: string | null;
    try {
      await this.bookAccessService.assertBookAccessible(userId, bookId);
      const [book] = await this.db
        .select({ title: schema.bookMetadata.title })
        .from(schema.books)
        .leftJoin(schema.bookMetadata, eq(schema.bookMetadata.bookId, schema.books.id))
        .where(eq(schema.books.id, bookId))
        .limit(1);
      bookTitle = book?.title ?? null;
    } catch {
      bookTitle = null;
    }

    return {
      ...counts,
      bookId,
      bookTitle,
    };
  }

  private async record(input: RecordBaseInput & { status: 'success' | 'failed'; errorClass: string | null; error: string | null }): Promise<void> {
    try {
      await this.db.insert(schema.koboSyncHistory).values({
        userId: input.userId,
        deviceId: input.deviceId,
        event: input.event,
        status: input.status,
        counts: input.counts ?? {},
        durationMs: Math.max(0, Math.trunc(input.durationMs)),
        errorClass: input.errorClass,
        error: input.error,
      });
      await this.pruneUserHistory(input.userId);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(
        `[kobo.sync_history] [fail] userId=${input.userId} durationMs=0 errorClass=${err.constructor.name} error="${sanitizeLogValue(err.message)}" - failed to record kobo sync history`,
      );
    }
  }

  private async pruneUserHistory(userId: number): Promise<void> {
    await this.db.execute(sql`
      DELETE FROM ${schema.koboSyncHistory}
      WHERE ${schema.koboSyncHistory.userId} = ${userId}
        AND ${schema.koboSyncHistory.id} NOT IN (
          SELECT ${schema.koboSyncHistory.id}
          FROM ${schema.koboSyncHistory}
          WHERE ${schema.koboSyncHistory.userId} = ${userId}
          ORDER BY ${schema.koboSyncHistory.createdAt} DESC, ${schema.koboSyncHistory.id} DESC
          LIMIT ${HISTORY_LIMIT}
        )
    `);
  }

  private asCounts(value: unknown): KoboSyncHistoryCounts {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as KoboSyncHistoryCounts;
  }
}
