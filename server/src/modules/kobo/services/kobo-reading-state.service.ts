import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db';
import * as schema from '../../../db/schema';
import { UserBookStatusService } from '../../user-book-status/user-book-status.service';
import { AchievementEventsService, ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED } from '../../achievement/achievement-events.service';
import { KoboBookAccessService } from './kobo-book-access.service';
import { KoboBookIdentityService } from './kobo-book-identity.service';

type Db = NodePgDatabase<typeof schema>;
type JsonObj = Record<string, unknown>;
const PROGRESS_EPSILON = 0.0001;

function mergeSubObject(incoming: JsonObj | null | undefined, existing: JsonObj | null | undefined): JsonObj | null {
  if (!incoming) return existing ?? null;
  if (!existing) return incoming;
  const a = incoming.LastModified as string | undefined;
  const b = existing.LastModified as string | undefined;
  if (!a || !b) return incoming;
  return a >= b ? incoming : existing;
}

@Injectable()
export class KoboReadingStateService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly bookAccessService: KoboBookAccessService,
    private readonly userBookStatusService: UserBookStatusService,
    private readonly bookIdentityService: KoboBookIdentityService,
    private readonly achievementEvents: AchievementEventsService,
  ) {}

  async upsertState(
    userId: number,
    bookId: number,
    payload: Record<string, unknown>,
    readingThreshold: number,
    finishedThreshold: number,
    twoWayProgressSync: boolean,
  ) {
    const now = new Date().toISOString();

    const book = await this.db.query.books.findFirst({
      where: eq(schema.books.id, bookId),
      columns: { id: true },
    });
    if (!book) {
      const entitlementId = String(bookId);
      return {
        RequestResult: 'Success',
        UpdateResults: [
          {
            EntitlementId: entitlementId,
            CurrentBookmarkResult: { Result: 'Ignored' },
            StatisticsResult: { Result: 'Ignored' },
            StatusInfoResult: { Result: 'Ignored' },
          },
        ],
      };
    }

    await this.bookAccessService.assertBookAccessible(userId, bookId);

    const identity = await this.bookIdentityService.ensureForBook(userId, bookId, await this.hasLibrarySnapshot(userId));
    const entitlementId = identity.entitlementId;

    const created = (payload.Created as string | undefined) ?? now;
    const lastModified = (payload.LastModified as string | undefined) ?? now;
    const priorityTimestamp = (payload.PriorityTimestamp as string | undefined) ?? lastModified;

    const incomingBookmark = (payload.CurrentBookmark as JsonObj | undefined) ?? null;
    const incomingStats = (payload.Statistics as JsonObj | undefined) ?? null;
    const incomingStatus = (payload.StatusInfo as JsonObj | undefined) ?? null;

    const existing = await this.db.query.koboReadingStates.findFirst({
      where: and(eq(schema.koboReadingStates.userId, userId), eq(schema.koboReadingStates.bookId, bookId)),
    });

    const mergedBookmark = mergeSubObject(incomingBookmark, existing?.currentBookmark as JsonObj | null);
    const mergedStats = mergeSubObject(incomingStats, existing?.statistics as JsonObj | null);
    const mergedStatus = mergeSubObject(incomingStatus, existing?.statusInfo as JsonObj | null);

    await this.db
      .insert(schema.koboReadingStates)
      .values({
        userId,
        bookId,
        entitlementId,
        createdAtKobo: created,
        lastModifiedKobo: lastModified,
        priorityTimestamp,
        currentBookmark: mergedBookmark,
        statistics: mergedStats,
        statusInfo: mergedStatus,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.koboReadingStates.userId, schema.koboReadingStates.bookId],
        set: {
          lastModifiedKobo: lastModified,
          priorityTimestamp,
          currentBookmark: sql`excluded.current_bookmark`,
          statistics: sql`excluded.statistics`,
          statusInfo: sql`excluded.status_info`,
          updatedAt: sql`now()`,
        },
      });

    const percent = this.extractPercent(mergedBookmark);
    if (percent !== null) {
      if (twoWayProgressSync) {
        await this.syncPercentToInternalProgress(
          userId,
          bookId,
          percent,
          this.extractProgressModifiedAt(mergedBookmark, lastModified),
          this.extractKoboLocationSource(mergedBookmark),
          this.extractKoboLocationType(mergedBookmark),
          this.extractKoboLocationValue(mergedBookmark),
          this.extractContentSourceProgressPercent(mergedBookmark),
        );
        await this.markSnapshotBookUnsynced(userId, bookId);
      }
      void this.userBookStatusService.autoUpdate(userId, bookId, percent, readingThreshold, finishedThreshold);
      this.achievementEvents.emit(ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED, {
        userId,
        bookId,
        progress: percent,
        source: 'kobo',
      });
    }

    return this.getRawState(userId, bookId);
  }

  async getRawState(userId: number, bookId: number): Promise<unknown> {
    const book = await this.db.query.books.findFirst({
      where: eq(schema.books.id, bookId),
      columns: { id: true },
    });
    if (!book) return null;

    await this.bookAccessService.assertBookAccessible(userId, bookId);

    const row = await this.db.query.koboReadingStates.findFirst({
      where: and(eq(schema.koboReadingStates.userId, userId), eq(schema.koboReadingStates.bookId, bookId)),
    });

    if (!row) return null;

    return {
      EntitlementId: (await this.bookIdentityService.ensureForBook(userId, bookId, await this.hasLibrarySnapshot(userId))).entitlementId,
      Created: row.createdAtKobo,
      LastModified: row.lastModifiedKobo,
      PriorityTimestamp: row.priorityTimestamp,
      CurrentBookmark: row.currentBookmark,
      Statistics: row.statistics,
      StatusInfo: row.statusInfo,
    };
  }

  private extractPercent(bookmark: JsonObj | null): number | null {
    if (!bookmark) return null;
    const pct = bookmark.ProgressPercent;
    if (typeof pct === 'number') return Math.max(0, Math.min(100, pct));
    return null;
  }

  private extractContentSourceProgressPercent(bookmark: JsonObj | null): number | null {
    if (!bookmark) return null;
    const pct = bookmark.ContentSourceProgressPercent;
    if (typeof pct === 'number' && Number.isFinite(pct)) return Math.max(0, Math.min(100, pct));
    return null;
  }

  private extractKoboLocationSource(bookmark: JsonObj | null): string | null {
    return this.extractKoboLocationPart(bookmark, 'Source');
  }

  private extractKoboLocationType(bookmark: JsonObj | null): string | null {
    return this.extractKoboLocationPart(bookmark, 'Type');
  }

  private extractKoboLocationValue(bookmark: JsonObj | null): string | null {
    return this.extractKoboLocationPart(bookmark, 'Value');
  }

  private extractKoboLocationPart(bookmark: JsonObj | null, key: 'Source' | 'Type' | 'Value'): string | null {
    const location = bookmark?.Location;
    if (!location || typeof location !== 'object' || Array.isArray(location)) return null;
    const value = (location as JsonObj)[key];
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private extractProgressModifiedAt(bookmark: JsonObj | null, fallback: string | undefined): Date {
    const bookmarkModified = typeof bookmark?.LastModified === 'string' ? bookmark.LastModified : undefined;
    return this.parseKoboTimestamp(bookmarkModified ?? fallback) ?? new Date();
  }

  private parseKoboTimestamp(value: string | undefined): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private async syncPercentToInternalProgress(
    userId: number,
    bookId: number,
    percentage: number,
    sourceUpdatedAt: Date,
    koboLocationSource: string | null,
    koboLocationType: string | null,
    koboLocationValue: string | null,
    koboContentSourceProgressPercent: number | null,
  ): Promise<void> {
    const [primaryFile] = await this.db
      .select({ fileId: schema.bookFiles.id })
      .from(schema.books)
      .innerJoin(schema.bookFiles, eq(schema.bookFiles.id, schema.books.primaryFileId))
      .where(and(eq(schema.books.id, bookId), eq(schema.bookFiles.format, 'epub')))
      .limit(1);

    if (!primaryFile) return;

    const [existing] = await this.db
      .select({
        percentage: schema.readingProgress.percentage,
        cfi: schema.readingProgress.cfi,
        koboLocationSource: schema.readingProgress.koboLocationSource,
        koboLocationType: schema.readingProgress.koboLocationType,
        koboLocationValue: schema.readingProgress.koboLocationValue,
        koboContentSourceProgressPercent: schema.readingProgress.koboContentSourceProgressPercent,
        updatedAt: schema.readingProgress.updatedAt,
      })
      .from(schema.readingProgress)
      .where(and(eq(schema.readingProgress.userId, userId), eq(schema.readingProgress.bookFileId, primaryFile.fileId)))
      .limit(1);

    if (existing?.updatedAt && existing.updatedAt.getTime() >= sourceUpdatedAt.getTime()) return;
    const samePercent = existing ? Math.abs(existing.percentage - percentage) < PROGRESS_EPSILON : false;
    if (
      samePercent &&
      existing?.cfi &&
      existing.koboLocationSource === koboLocationSource &&
      existing.koboLocationType === koboLocationType &&
      existing.koboLocationValue === koboLocationValue &&
      existing.koboContentSourceProgressPercent === koboContentSourceProgressPercent
    ) {
      return;
    }
    const nextCfi = samePercent ? (existing?.cfi ?? null) : null;

    await this.db
      .insert(schema.readingProgress)
      .values({
        userId,
        bookFileId: primaryFile.fileId,
        percentage,
        cfi: nextCfi,
        pageNumber: null,
        positionSeconds: null,
        koboLocationSource,
        koboLocationType,
        koboLocationValue,
        koboContentSourceProgressPercent,
        updatedAt: sourceUpdatedAt,
      })
      .onConflictDoUpdate({
        target: [schema.readingProgress.bookFileId, schema.readingProgress.userId],
        set: {
          percentage,
          cfi: nextCfi,
          pageNumber: null,
          positionSeconds: null,
          koboLocationSource,
          koboLocationType,
          koboLocationValue,
          koboContentSourceProgressPercent,
          updatedAt: sourceUpdatedAt,
        },
      });
  }

  private async markSnapshotBookUnsynced(userId: number, bookId: number): Promise<void> {
    await this.db.execute(sql`
      UPDATE ${schema.koboSnapshotBooks} AS sb
      SET synced = false,
          is_new = false
      FROM ${schema.koboLibrarySnapshots} AS snap
      WHERE snap.id = sb.snapshot_id
        AND snap.user_id = ${userId}
        AND sb.book_id = ${bookId}
        AND sb.pending_delete = false
        AND sb.removed_by_device = false
    `);
  }

  private async hasLibrarySnapshot(userId: number): Promise<boolean> {
    const snapshot = await this.db.query.koboLibrarySnapshots.findFirst({
      where: eq(schema.koboLibrarySnapshots.userId, userId),
      columns: { id: true },
    });
    return Boolean(snapshot);
  }
}
