import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, lt, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db';
import * as schema from '../../../db/schema';
import {
  bookRequestDownloads,
  bookRequestUploadFiles,
  type BookRequestDownloadRow,
  type BookRequestUploadFileRow,
  type NewBookRequestUploadFileRow,
} from '../../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export interface RequestUploadFileWithAttempt {
  file: BookRequestUploadFileRow;
  download: BookRequestDownloadRow;
}

export interface RequestUploadTotals {
  fileCount: number;
  receivedCount: number;
  receivedBytes: number;
  totalBytes: number;
}

/** The files an `upload` attempt expects. Bounded by the plan's own file limit per attempt. */
@Injectable()
export class RequestUploadFileRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async createMany(rows: NewBookRequestUploadFileRow[]): Promise<BookRequestUploadFileRow[]> {
    if (rows.length === 0) return [];
    return this.db.insert(bookRequestUploadFiles).values(rows).returning();
  }

  async findForDownload(downloadId: number): Promise<BookRequestUploadFileRow[]> {
    return this.db
      .select()
      .from(bookRequestUploadFiles)
      .where(eq(bookRequestUploadFiles.downloadId, downloadId))
      .orderBy(asc(bookRequestUploadFiles.id));
  }

  async findWithAttempt(fileId: number): Promise<RequestUploadFileWithAttempt | undefined> {
    const [row] = await this.db
      .select({ file: bookRequestUploadFiles, download: bookRequestDownloads })
      .from(bookRequestUploadFiles)
      .innerJoin(bookRequestDownloads, eq(bookRequestDownloads.id, bookRequestUploadFiles.downloadId))
      .where(eq(bookRequestUploadFiles.id, fileId))
      .limit(1);
    return row;
  }

  /** Only forward, and only while the file is still expected, so a late chunk never rewinds it. */
  async recordProgress(fileId: number, receivedBytes: number): Promise<boolean> {
    const rows = await this.db
      .update(bookRequestUploadFiles)
      .set({ receivedBytes: sql`least(${receivedBytes}, ${bookRequestUploadFiles.sizeBytes})` })
      .where(
        and(
          eq(bookRequestUploadFiles.id, fileId),
          eq(bookRequestUploadFiles.status, 'pending'),
          lt(bookRequestUploadFiles.receivedBytes, receivedBytes),
        ),
      )
      .returning({ id: bookRequestUploadFiles.id });
    return rows.length > 0;
  }

  /** Conditional, so two sessions finishing the same file cannot both count it. */
  async markReceived(fileId: number): Promise<BookRequestUploadFileRow | undefined> {
    const [row] = await this.db
      .update(bookRequestUploadFiles)
      .set({ status: 'received', receivedBytes: sql`${bookRequestUploadFiles.sizeBytes}`, receivedAt: new Date() })
      .where(and(eq(bookRequestUploadFiles.id, fileId), eq(bookRequestUploadFiles.status, 'pending')))
      .returning();
    return row;
  }

  async totals(downloadId: number): Promise<RequestUploadTotals> {
    const [row] = await this.db
      .select({
        fileCount: sql<number>`count(*)::int`,
        receivedCount: sql<number>`count(*) filter (where ${bookRequestUploadFiles.status} = 'received')::int`,
        receivedBytes: sql<number>`coalesce(sum(${bookRequestUploadFiles.receivedBytes}), 0)::bigint`,
        totalBytes: sql<number>`coalesce(sum(${bookRequestUploadFiles.sizeBytes}), 0)::bigint`,
      })
      .from(bookRequestUploadFiles)
      .where(eq(bookRequestUploadFiles.downloadId, downloadId));
    return {
      fileCount: Number(row?.fileCount ?? 0),
      receivedCount: Number(row?.receivedCount ?? 0),
      receivedBytes: Number(row?.receivedBytes ?? 0),
      totalBytes: Number(row?.totalBytes ?? 0),
    };
  }

  async idsForDownload(downloadId: number): Promise<number[]> {
    const rows = await this.db
      .select({ id: bookRequestUploadFiles.id })
      .from(bookRequestUploadFiles)
      .where(eq(bookRequestUploadFiles.downloadId, downloadId));
    return rows.map((row) => row.id);
  }
}
