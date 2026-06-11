import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db';
import * as schema from '../../../db/schema';
import { UserBookStatusService } from '../../user-book-status/user-book-status.service';
import { AchievementEventsService, ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED } from '../../achievement/achievement-events.service';
import { KoboBookAccessService } from './kobo-book-access.service';
import { KoboBookIdentityService } from './kobo-book-identity.service';
import { KoboProgressBridgeService } from './kobo-progress-bridge.service';
import { KoboSettingsService } from './kobo-settings.service';

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

/**
 * Returns the chronologically latest of the given timestamps, preserving the original
 * string. The Kobo device resolves reading-state conflicts on the envelope LastModified/
 * PriorityTimestamp, so these must never regress below the bookmark they wrap: a device
 * re-push of its older state must not lower an envelope that already carries a newer
 * hub-refreshed bookmark, or the device keeps rejecting the hub progress forever.
 */
function maxIsoTimestamp(...values: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) continue;
    const ms = new Date(value).getTime();
    if (Number.isNaN(ms) || ms <= bestMs) continue;
    bestMs = ms;
    best = value;
  }
  return best;
}

@Injectable()
export class KoboReadingStateService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly bookAccessService: KoboBookAccessService,
    private readonly userBookStatusService: UserBookStatusService,
    private readonly bookIdentityService: KoboBookIdentityService,
    private readonly progressBridge: KoboProgressBridgeService,
    private readonly settingsService: KoboSettingsService,
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

    const bookmarkModified = typeof mergedBookmark?.LastModified === 'string' ? mergedBookmark.LastModified : undefined;
    const effectiveLastModified = maxIsoTimestamp(lastModified, existing?.lastModifiedKobo, bookmarkModified) ?? lastModified;
    const effectivePriority = maxIsoTimestamp(priorityTimestamp, existing?.priorityTimestamp, bookmarkModified) ?? priorityTimestamp;

    await this.db
      .insert(schema.koboReadingStates)
      .values({
        userId,
        bookId,
        entitlementId,
        createdAtKobo: created,
        lastModifiedKobo: effectiveLastModified,
        priorityTimestamp: effectivePriority,
        currentBookmark: mergedBookmark,
        statistics: mergedStats,
        statusInfo: mergedStatus,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.koboReadingStates.userId, schema.koboReadingStates.bookId],
        set: {
          lastModifiedKobo: effectiveLastModified,
          priorityTimestamp: effectivePriority,
          currentBookmark: sql`excluded.current_bookmark`,
          statistics: sql`excluded.statistics`,
          statusInfo: sql`excluded.status_info`,
          updatedAt: sql`now()`,
        },
      });

    const percent = this.extractPercent(mergedBookmark);
    if (percent !== null) {
      if (twoWayProgressSync) {
        const locationSource = this.extractKoboLocationSource(mergedBookmark);
        const locationType = this.extractKoboLocationType(mergedBookmark);
        const locationValue = this.extractKoboLocationValue(mergedBookmark);

        // KoboSpan bookmarks convert to precise canonical points; web and KOReader
        // resume at the same paragraph instead of a percent approximation.
        const precise =
          locationType === 'KoboSpan' && locationSource && locationValue
            ? await this.progressBridge.koboBookmarkToCanonical(userId, bookId, locationSource, locationValue)
            : null;

        await this.syncPercentToInternalProgress(
          userId,
          bookId,
          percent,
          this.extractProgressModifiedAt(mergedBookmark, lastModified),
          locationSource,
          locationType,
          locationValue,
          this.extractContentSourceProgressPercent(mergedBookmark),
          precise,
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

    const refreshed = await this.refreshBookmarkFromHub(userId, bookId, this.asJsonObj(row.currentBookmark)).catch(() => null);

    return {
      EntitlementId: (await this.bookIdentityService.ensureForBook(userId, bookId, await this.hasLibrarySnapshot(userId))).entitlementId,
      Created: row.createdAtKobo,
      LastModified: refreshed?.lastModifiedKobo ?? row.lastModifiedKobo,
      PriorityTimestamp: refreshed?.lastModifiedKobo ?? row.priorityTimestamp,
      CurrentBookmark: refreshed?.bookmark ?? row.currentBookmark,
      Statistics: row.statistics,
      StatusInfo: row.statusInfo,
    };
  }

  /**
   * Computes a precise KoboSpan Location for the bookmark when the hub position moved
   * since the device last reported. readingProgress.koboLocationValue is set only by
   * device-originated progress (or a previous refresh), so a present cfi with a null
   * value means the web reader or KOReader owns the current position.
   */
  private async refreshBookmarkFromHub(
    userId: number,
    bookId: number,
    bookmark: JsonObj | null,
  ): Promise<{ bookmark: JsonObj; lastModifiedKobo: string } | null> {
    const settings = await this.settingsService.getSettings(userId);
    if (!settings.twoWayProgressSync) return null;

    const [primaryFile] = await this.db
      .select({ fileId: schema.bookFiles.id })
      .from(schema.books)
      .innerJoin(schema.bookFiles, eq(schema.bookFiles.id, schema.books.primaryFileId))
      .where(and(eq(schema.books.id, bookId), eq(schema.bookFiles.format, 'epub')))
      .limit(1);
    if (!primaryFile) return null;

    const [progress] = await this.db
      .select({
        cfi: schema.readingProgress.cfi,
        percentage: schema.readingProgress.percentage,
        koboLocationValue: schema.readingProgress.koboLocationValue,
      })
      .from(schema.readingProgress)
      .where(and(eq(schema.readingProgress.userId, userId), eq(schema.readingProgress.bookFileId, primaryFile.fileId)))
      .limit(1);
    if (!progress?.cfi || progress.koboLocationValue) return null;

    const point = await this.progressBridge.cfiToKoboBookmark(userId, bookId, progress.cfi);
    if (!point) return null;

    const existingLocation = this.asJsonObj(bookmark?.Location ?? null);
    const sameLocation = existingLocation?.Value === point.value && existingLocation?.Source === point.source;
    const samePercent = typeof bookmark?.ProgressPercent === 'number' && Math.abs(bookmark.ProgressPercent - progress.percentage) < PROGRESS_EPSILON;
    if (sameLocation && samePercent) {
      await this.stampProgressLocation(userId, primaryFile.fileId, point);
      return null;
    }

    const nowIso = new Date().toISOString();
    const merged: JsonObj = {
      ...(bookmark ?? {}),
      LastModified: nowIso,
      ProgressPercent: progress.percentage,
      Location: { Source: point.source, Type: 'KoboSpan', Value: point.value },
    };
    if (point.contentSourceProgressPercent != null) merged.ContentSourceProgressPercent = point.contentSourceProgressPercent;
    else delete merged.ContentSourceProgressPercent;

    await this.db
      .update(schema.koboReadingStates)
      .set({ currentBookmark: merged, lastModifiedKobo: nowIso, priorityTimestamp: nowIso, updatedAt: new Date() })
      .where(and(eq(schema.koboReadingStates.userId, userId), eq(schema.koboReadingStates.bookId, bookId)));
    await this.stampProgressLocation(userId, primaryFile.fileId, point);

    return { bookmark: merged, lastModifiedKobo: nowIso };
  }

  /** Records which Location the bookmark reflects; deliberately keeps updatedAt untouched. */
  private async stampProgressLocation(
    userId: number,
    fileId: number,
    point: { source: string; value: string; contentSourceProgressPercent: number | null },
  ): Promise<void> {
    await this.db
      .update(schema.readingProgress)
      .set({
        koboLocationSource: point.source,
        koboLocationType: 'KoboSpan',
        koboLocationValue: point.value,
        koboContentSourceProgressPercent: point.contentSourceProgressPercent,
        updatedAt: sql`"reading_progress"."updated_at"`,
      })
      .where(and(eq(schema.readingProgress.userId, userId), eq(schema.readingProgress.bookFileId, fileId)));
  }

  private asJsonObj(value: unknown): JsonObj | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as JsonObj;
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
    precise: { cfi: string; xpointer: string } | null,
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
    const nextCfi = precise?.cfi ?? (samePercent ? (existing?.cfi ?? null) : null);
    const nextXpointer = precise?.xpointer ?? null;

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
        koreaderProgress: nextXpointer,
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
          ...(nextXpointer != null ? { koreaderProgress: nextXpointer } : {}),
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
