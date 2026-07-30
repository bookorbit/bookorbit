import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { ReadStatus } from '@bookorbit/types';
import { DB } from '../../db';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export type KoboReadingStatus = 'ReadyToRead' | 'Reading' | 'Finished';

const PROJECTION_BATCH_SIZE = 500;

/**
 * Kobo only models three states, so several BookOrbit statuses collapse onto one.
 * `abandoned` maps to Reading rather than ReadyToRead so the device keeps the
 * bookmark instead of presenting the book as never opened.
 */
const KOBO_STATUS_BY_READ_STATUS: Record<ReadStatus, KoboReadingStatus> = {
  unread: 'ReadyToRead',
  want_to_read: 'ReadyToRead',
  reading: 'Reading',
  on_hold: 'Reading',
  rereading: 'Reading',
  read: 'Finished',
  skimmed: 'Finished',
  abandoned: 'Reading',
};

export function toKoboReadingStatus(status: ReadStatus): KoboReadingStatus {
  return KOBO_STATUS_BY_READ_STATUS[status];
}

/**
 * Publishes BookOrbit read status onto the Kobo reading state so a status set in the
 * web UI (or by KOReader/Hardcover) reaches registered devices. Only StatusInfo is
 * written: CurrentBookmark stays owned by reading progress, which the reading-state
 * pull path may recompute from the hub position at delivery time.
 */
@Injectable()
export class KoboStatusProjectionRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async isEnabled(userId: number): Promise<boolean> {
    const [settings] = await this.db
      .select({ twoWayProgressSync: schema.koboSyncSettings.twoWayProgressSync })
      .from(schema.koboSyncSettings)
      .where(eq(schema.koboSyncSettings.userId, userId))
      .limit(1);
    return settings?.twoWayProgressSync === true;
  }

  /** Returns the book ids whose Kobo status actually changed. */
  async project(userId: number, bookIds: number[], status: ReadStatus): Promise<number[]> {
    const uniqueBookIds = [...new Set(bookIds)];
    if (uniqueBookIds.length === 0) return [];

    const koboStatus = toKoboReadingStatus(status);
    const changed: number[] = [];

    for (let index = 0; index < uniqueBookIds.length; index += PROJECTION_BATCH_SIZE) {
      const chunk = uniqueBookIds.slice(index, index + PROJECTION_BATCH_SIZE);
      const updated = await this.upsertStatusInfo(userId, chunk, koboStatus);
      if (updated.length === 0) continue;
      await this.markSnapshotBooksUnsynced(userId, updated);
      changed.push(...updated);
    }

    return changed;
  }

  private async upsertStatusInfo(userId: number, bookIds: number[], koboStatus: KoboReadingStatus): Promise<number[]> {
    const nowIso = new Date().toISOString();
    const timesStartedReading = koboStatus === 'ReadyToRead' ? 0 : 1;
    const values = sql.join(
      bookIds.map((bookId) => sql`(${bookId}::integer)`),
      sql`, `,
    );

    const result = await this.db.execute<{ book_id: number }>(sql`
      INSERT INTO ${schema.koboReadingStates}
        (user_id, book_id, entitlement_id, created_at_kobo, last_modified_kobo, priority_timestamp, current_bookmark, statistics, status_info, updated_at)
      SELECT
        ${userId},
        b.book_id,
        COALESCE(e.entitlement_id::text, b.book_id::text),
        ${nowIso},
        ${nowIso},
        ${nowIso},
        jsonb_build_object('LastModified', ${nowIso}::text, 'ProgressPercent', 0),
        jsonb_build_object('LastModified', ${nowIso}::text),
        jsonb_build_object('LastModified', ${nowIso}::text, 'Status', ${koboStatus}::text, 'TimesStartedReading', ${timesStartedReading}::integer),
        now()
      FROM (VALUES ${values}) AS b(book_id)
      JOIN ${schema.books} AS bk ON bk.id = b.book_id
      JOIN ${schema.bookFiles} AS bf ON bf.id = bk.primary_file_id AND bf.format IN ('epub', 'kepub')
      LEFT JOIN ${schema.koboBookEntitlements} AS e ON e.user_id = ${userId} AND e.book_id = b.book_id
      ON CONFLICT (user_id, book_id) DO UPDATE
      SET last_modified_kobo = ${nowIso},
          priority_timestamp = ${nowIso},
          status_info = COALESCE(${schema.koboReadingStates}.status_info, '{}'::jsonb)
            || jsonb_build_object('LastModified', ${nowIso}::text, 'Status', ${koboStatus}::text),
          updated_at = now()
      WHERE COALESCE(${schema.koboReadingStates}.status_info->>'Status', '') IS DISTINCT FROM ${koboStatus}
      RETURNING book_id
    `);

    return (result?.rows ?? []).map((row) => Number(row.book_id));
  }

  private async markSnapshotBooksUnsynced(userId: number, bookIds: number[]): Promise<void> {
    const ids = sql.join(
      bookIds.map((bookId) => sql`${bookId}`),
      sql`, `,
    );

    await this.db.execute(sql`
      UPDATE ${schema.koboSnapshotBooks} AS sb
      SET synced = false,
          is_new = false
      FROM ${schema.koboLibrarySnapshots} AS snap
      WHERE snap.id = sb.snapshot_id
        AND snap.user_id = ${userId}
        AND sb.book_id IN (${ids})
        AND sb.synced = true
        AND sb.pending_delete = false
        AND sb.removed_by_device = false
    `);
  }
}
