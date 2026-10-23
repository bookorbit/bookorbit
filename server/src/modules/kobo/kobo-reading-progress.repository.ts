import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, lt, lte, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DB } from '../../db';
import * as schema from '../../db/schema';

@Injectable()
export class KoboReadingProgressRepository {
  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async findPrimaryFileId(bookId: number): Promise<number | null> {
    const [file] = await this.db
      .select({ fileId: schema.bookFiles.id })
      .from(schema.books)
      .innerJoin(schema.bookFiles, eq(schema.bookFiles.id, schema.books.primaryFileId))
      .where(and(eq(schema.books.id, bookId), inArray(schema.bookFiles.format, ['epub', 'kepub'])))
      .limit(1);
    return file?.fileId ?? null;
  }

  async isReaderFileOfBook(bookId: number, fileId: number): Promise<boolean> {
    const [file] = await this.db
      .select({ id: schema.bookFiles.id })
      .from(schema.bookFiles)
      .where(and(eq(schema.bookFiles.id, fileId), eq(schema.bookFiles.bookId, bookId), inArray(schema.bookFiles.format, ['epub', 'kepub'])))
      .limit(1);
    return Boolean(file);
  }

  async findForFile(userId: number, fileId: number) {
    const [progress] = await this.db
      .select({
        percentage: schema.readingProgress.percentage,
        cfi: schema.readingProgress.cfi,
        koreaderProgress: schema.readingProgress.koreaderProgress,
        koboLocationSource: schema.readingProgress.koboLocationSource,
        koboLocationType: schema.readingProgress.koboLocationType,
        koboLocationValue: schema.readingProgress.koboLocationValue,
        koboContentSourceProgressPercent: schema.readingProgress.koboContentSourceProgressPercent,
        mediaOverlayFragment: schema.readingProgress.mediaOverlayFragment,
        mediaOverlaySectionIndex: schema.readingProgress.mediaOverlaySectionIndex,
        textUpdatedAt: schema.readingProgress.textUpdatedAt,
        narrationUpdatedAt: schema.readingProgress.narrationUpdatedAt,
        updatedAt: schema.readingProgress.updatedAt,
      })
      .from(schema.readingProgress)
      .where(and(eq(schema.readingProgress.userId, userId), eq(schema.readingProgress.bookFileId, fileId)))
      .limit(1);
    return progress;
  }

  async save(
    values: typeof schema.readingProgress.$inferInsert & { percentage: number; updatedAt: Date },
    uncertainDelivery: boolean,
  ): Promise<boolean> {
    const rows = await this.db
      .insert(schema.readingProgress)
      .values(values)
      .onConflictDoUpdate({
        target: [schema.readingProgress.bookFileId, schema.readingProgress.userId],
        set: values,
        setWhere: and(
          lt(schema.readingProgress.updatedAt, values.updatedAt!),
          ...(uncertainDelivery ? [lte(schema.readingProgress.percentage, values.percentage)] : []),
        ),
      })
      .returning({ bookFileId: schema.readingProgress.bookFileId });
    return rows.length > 0;
  }

  async stampLocation(userId: number, fileId: number, point: { source: string; value: string; contentSourceProgressPercent: number | null }) {
    await this.db
      .update(schema.readingProgress)
      .set({
        koboLocationSource: point.source,
        koboLocationType: 'KoboSpan',
        koboLocationValue: point.value,
        koboContentSourceProgressPercent: point.contentSourceProgressPercent,
        updatedAt: sql`"reading_progress"."updated_at"`,
        lastReadAt: sql`"reading_progress"."last_read_at"`,
      })
      .where(and(eq(schema.readingProgress.userId, userId), eq(schema.readingProgress.bookFileId, fileId)));
  }

  async findFinishThreshold(bookId: number): Promise<number | null> {
    const [row] = await this.db
      .select({ threshold: schema.libraries.markAsFinishedPercentComplete })
      .from(schema.books)
      .innerJoin(schema.libraries, eq(schema.libraries.id, schema.books.libraryId))
      .where(eq(schema.books.id, bookId))
      .limit(1);
    return row?.threshold ?? null;
  }

  async findKnownPosition(userId: number, deviceId: number, bookId: number) {
    const [known] = await this.db
      .select({
        locationSource: schema.koboKnownPositions.locationSource,
        locationValue: schema.koboKnownPositions.locationValue,
        positionSetAt: schema.koboKnownPositions.positionSetAt,
      })
      .from(schema.koboKnownPositions)
      .where(
        and(
          eq(schema.koboKnownPositions.userId, userId),
          eq(schema.koboKnownPositions.deviceId, deviceId),
          eq(schema.koboKnownPositions.bookId, bookId),
        ),
      )
      .limit(1);
    return known ?? null;
  }

  async recordKnownPosition(
    userId: number,
    deviceId: number,
    bookId: number,
    position: { locationSource: string; locationValue: string; positionSetAt: Date },
  ) {
    await this.db
      .insert(schema.koboKnownPositions)
      .values({ userId, deviceId, bookId, ...position })
      .onConflictDoUpdate({
        target: [schema.koboKnownPositions.userId, schema.koboKnownPositions.deviceId, schema.koboKnownPositions.bookId],
        set: { ...position, updatedAt: sql`now()` },
      });
  }

  async markDeviceBookUnsynced(userId: number, deviceId: number, bookId: number) {
    await this.db.execute(sql`
      UPDATE ${schema.koboSnapshotBooks} AS sb
      SET synced = false
      FROM ${schema.koboLibrarySnapshots} AS snap
      WHERE snap.id = sb.snapshot_id
        AND snap.user_id = ${userId}
        AND snap.device_id = ${deviceId}
        AND sb.book_id = ${bookId}
        AND sb.pending_delete = false
        AND sb.removed_by_device = false
    `);
  }
}
