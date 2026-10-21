import { isDeepStrictEqual } from 'node:util';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db';
import * as schema from '../../../db/schema';
import { UserBookStatusService } from '../../user-book-status/user-book-status.service';
import { ReadingSessionService } from '../../reading-session/reading-session.service';
import { AchievementEventsService, ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED } from '../../achievement/achievement-events.service';
import { BookService } from '../../book/book.service';
import {
  KOBO_STATISTICS_CURSOR_SOURCE,
  koboSourceDeviceKey,
  koboStatisticsSessionId,
  koboStatisticsSessionIdPrefix,
} from '../kobo-statistics-session.util';
import { KoboAnalyticsResolverService } from './kobo-analytics-resolver.service';
import { KoboReadingProgressRepository } from '../kobo-reading-progress.repository';
import { KoboDeliveryService, isSettledDelivery, isUnconfirmedReplacement, type KoboDeliveryRecord } from './kobo-delivery.service';
import { KoboBookAccessService } from './kobo-book-access.service';
import { KoboBookIdentityService } from './kobo-book-identity.service';
import { KoboProgressBridgeService, type CanonicalProgressPoint } from './kobo-progress-bridge.service';
import { KoboSettingsService } from './kobo-settings.service';
import { advanceIsoTimestamp, maxIsoTimestamp } from '../../../common/utils/iso-timestamp.utils';
import { hasReachedProgressThreshold } from '../../../common/utils/progress-threshold.utils';
import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { resolveTimeZone } from '../../../common/utils/timezone.utils';

type Db = NodePgDatabase<typeof schema>;
type JsonObj = Record<string, unknown>;
type PositionStamps = { textUpdatedAt: Date | null; narrationUpdatedAt: Date | null; updatedAt: Date | null };
const PROGRESS_EPSILON = 0.0001;
const STATISTICS_SESSION_EVENT = 'kobo.statistics_session';
const MAX_STATISTICS_MINUTES = Math.floor(2_147_483_647 / 60);

type KoboSectionResult = { Result: 'Success' | 'Ignored' };

/** Acknowledgement envelope the device expects from `PUT /v1/library/{id}/state`. */
export interface KoboStateUpdateResponse {
  RequestResult: 'Success';
  UpdateResults: {
    EntitlementId: string;
    CurrentBookmarkResult: KoboSectionResult;
    StatisticsResult: KoboSectionResult;
    StatusInfoResult: KoboSectionResult;
  }[];
}

/**
 * The device keeps a pushed reading state pending until the response acknowledges every
 * section, and treats its own pending copy as authoritative meanwhile: it re-pushes on each
 * sync and opens the book at its local bookmark no matter what the pull path delivered.
 * Sections are reported wholesale rather than per merge outcome, so a bookmark the hub kept
 * ownership of still clears on the device and loses to the newer state on the next pull.
 */
function buildStateUpdateResponse(entitlementId: string, result: 'Success' | 'Ignored'): KoboStateUpdateResponse {
  return {
    RequestResult: 'Success',
    UpdateResults: [
      {
        EntitlementId: entitlementId,
        CurrentBookmarkResult: { Result: result },
        StatisticsResult: { Result: result },
        StatusInfoResult: { Result: result },
      },
    ],
  };
}

function mergeSubObject(incoming: JsonObj | null | undefined, existing: JsonObj | null | undefined): JsonObj | null {
  if (!incoming) return existing ?? null;
  if (!existing) return incoming;
  const a = incoming.LastModified as string | undefined;
  const b = existing.LastModified as string | undefined;
  if (!a || !b) return incoming;
  const aMs = new Date(a).getTime();
  const bMs = new Date(b).getTime();
  if (!Number.isNaN(aMs) && !Number.isNaN(bMs)) return aMs >= bMs ? incoming : existing;
  return a >= b ? incoming : existing;
}

@Injectable()
export class KoboReadingStateService {
  private readonly logger = new Logger(KoboReadingStateService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly bookAccessService: KoboBookAccessService,
    private readonly userBookStatusService: UserBookStatusService,
    private readonly bookIdentityService: KoboBookIdentityService,
    private readonly progressBridge: KoboProgressBridgeService,
    private readonly settingsService: KoboSettingsService,
    private readonly achievementEvents: AchievementEventsService,
    private readonly analyticsResolver: KoboAnalyticsResolverService,
    private readonly readingSessions: ReadingSessionService,
    private readonly bookService: BookService,
    private readonly progressRepository: KoboReadingProgressRepository,
    @Optional() private readonly deliveries?: KoboDeliveryService,
  ) {}

  async upsertState(
    userId: number,
    bookId: number,
    payload: Record<string, unknown>,
    readingThreshold: number,
    finishedThreshold: number,
    twoWayProgressSync: boolean,
    sourceDeviceId: number,
  ): Promise<KoboStateUpdateResponse> {
    const startedAt = Date.now();
    const now = new Date().toISOString();

    const book = await this.db.query.books.findFirst({
      where: eq(schema.books.id, bookId),
      columns: { id: true },
    });
    if (!book) return buildStateUpdateResponse(String(bookId), 'Ignored');

    await this.bookAccessService.assertBookAccessible(userId, bookId);

    const identity = await this.bookIdentityService.ensureForBook(userId, bookId, await this.hasLibrarySnapshot(userId));
    const entitlementId = identity.entitlementId;

    const created = (payload.Created as string | undefined) ?? now;
    const lastModified = (payload.LastModified as string | undefined) ?? now;
    const priorityTimestamp = (payload.PriorityTimestamp as string | undefined) ?? lastModified;

    const incomingBookmark = (payload.CurrentBookmark as JsonObj | undefined) ?? null;
    const incomingStats = (payload.Statistics as JsonObj | undefined) ?? null;
    const incomingStatus = (payload.StatusInfo as JsonObj | undefined) ?? null;

    const existing = await this.db.query.koboDeviceReadingStates.findFirst({
      where: and(
        eq(schema.koboDeviceReadingStates.userId, userId),
        eq(schema.koboDeviceReadingStates.deviceId, sourceDeviceId),
        eq(schema.koboDeviceReadingStates.bookId, bookId),
      ),
    });

    const shared = await this.db.query.koboReadingStates.findFirst({
      where: and(eq(schema.koboReadingStates.userId, userId), eq(schema.koboReadingStates.bookId, bookId)),
    });
    const previousBookmark = this.asJsonObj(existing?.currentBookmark ?? null);
    const previousStats = this.asJsonObj(existing?.statistics ?? null);
    const previousStatus = this.asJsonObj(existing?.statusInfo ?? null);
    const previousPercent = this.extractPercent(previousBookmark);
    const previousTimesStarted = typeof previousStatus?.TimesStartedReading === 'number' ? previousStatus.TimesStartedReading : null;

    const mergedBookmark = mergeSubObject(incomingBookmark, existing?.currentBookmark as JsonObj | null);
    const mergedStats = mergeSubObject(incomingStats, existing?.statistics as JsonObj | null);
    const mergedStatus = mergeSubObject(incomingStatus, existing?.statusInfo as JsonObj | null);
    const bookmarkChanged = !isDeepStrictEqual(mergedBookmark, previousBookmark);
    const statisticsChanged = !isDeepStrictEqual(mergedStats, previousStats);
    const statusChanged = !isDeepStrictEqual(mergedStatus, previousStatus);
    const stateChanged = bookmarkChanged || statisticsChanged || statusChanged;

    const mergedPercent = this.extractPercent(mergedBookmark);
    const delivery = await this.deliveries?.current(userId, sourceDeviceId, bookId);
    const preparedPrevious = delivery?.state === 'prepared' ? delivery.previousId : null;
    const deliveryId = preparedPrevious ?? delivery?.id ?? null;
    // Confirming a replacement moves the stored bookmark onto it, but one confirmed before that did
    // still points at the copy it replaced; the confirmation already says the device switched.
    const confirmedOverPrevious = delivery?.state === 'user_confirmed' && existing?.deliveryId === delivery.previousId;
    const uncertainDelivery = Boolean(
      this.deliveries &&
      (!delivery ||
        (!preparedPrevious && !isSettledDelivery(delivery)) ||
        (existing?.deliveryId && existing.deliveryId !== deliveryId && !confirmedOverPrevious)),
    );
    let protectedRegression = false;
    const initialZero = Boolean(this.deliveries && mergedPercent === 0 && (previousPercent === null || previousPercent === 0));
    // A replacement copy opens wherever the device left it after the re-download, often its start, so
    // even once confirmed it may only move saved progress forward; its precise locations still count.
    const replacedCopy = !preparedPrevious && Boolean(delivery && (delivery.previousId || delivery.options.replacement));
    const locationSource = uncertainDelivery ? null : this.extractKoboLocationSource(mergedBookmark);
    const locationType = uncertainDelivery ? null : this.extractKoboLocationType(mergedBookmark);
    const locationValue = uncertainDelivery ? null : this.extractKoboLocationValue(mergedBookmark);
    // KoboSpan bookmarks convert to precise canonical points; web and KOReader
    // resume at the same paragraph instead of a percent approximation.
    let precise: CanonicalProgressPoint | null | undefined;
    const resolvePrecise = async () => {
      if (precise === undefined)
        precise =
          twoWayProgressSync && locationType === 'KoboSpan' && locationSource && locationValue
            ? await this.progressBridge.koboBookmarkToCanonical(userId, bookId, locationSource, locationValue, sourceDeviceId)
            : null;
      return precise;
    };
    let guardBackwards = uncertainDelivery || initialZero || replacedCopy;
    if (guardBackwards && mergedPercent !== null) {
      const fileId = await this.progressFileFor(bookId, delivery);
      const canonical = fileId ? await this.progressRepository.findForFile(userId, fileId) : null;
      const savedPercent = canonical?.percentage ?? this.extractPercent(this.asJsonObj(shared?.currentBookmark));
      protectedRegression = savedPercent !== null && savedPercent > mergedPercent + PROGRESS_EPSILON;
      // A replacement copy's percentages run on its own scale, so where it names its position exactly,
      // that position, not the percentage, says whether it moved back.
      if (protectedRegression && !uncertainDelivery && !initialZero && canonical?.cfi) {
        const point = await resolvePrecise();
        const order = point ? this.progressBridge.comparePositions(point.cfi, canonical.cfi) : null;
        if (order !== null && order >= 0) {
          protectedRegression = false;
          guardBackwards = false;
        }
      }
    }
    const mergedTimesStarted = typeof mergedStatus?.TimesStartedReading === 'number' ? mergedStatus.TimesStartedReading : null;
    const strongRereadEvidence =
      (mergedStatus?.Status === 'Reading' && previousStatus?.Status !== 'Reading') ||
      (mergedTimesStarted !== null && previousTimesStarted !== null && mergedTimesStarted > previousTimesStarted) ||
      (mergedPercent !== null && previousPercent !== null && previousPercent - mergedPercent >= 10);

    const bookmarkModified = typeof mergedBookmark?.LastModified === 'string' ? mergedBookmark.LastModified : undefined;
    const effectiveLastModified = maxIsoTimestamp(lastModified, existing?.lastModifiedKobo, bookmarkModified) ?? lastModified;
    const effectivePriority = maxIsoTimestamp(priorityTimestamp, existing?.priorityTimestamp, bookmarkModified) ?? priorityTimestamp;

    const echoed =
      !protectedRegression &&
      bookmarkChanged &&
      locationSource !== null &&
      locationValue !== null &&
      (await this.returnsKnownPosition(userId, bookId, sourceDeviceId, delivery, locationSource, locationValue, previousBookmark));
    if (echoed) protectedRegression = true;

    if (!protectedRegression && bookmarkChanged && mergedPercent !== null) {
      const point = await resolvePrecise();
      const movedAt = this.extractProgressModifiedAt(mergedBookmark, lastModified);
      const outcome = await this.syncPercentToInternalProgress(
        userId,
        bookId,
        mergedPercent,
        movedAt,
        locationSource,
        locationType,
        locationValue,
        uncertainDelivery ? null : this.extractContentSourceProgressPercent(mergedBookmark),
        point,
        guardBackwards,
        delivery,
      );
      protectedRegression = outcome === 'regressed';
      if (outcome === 'applied' && locationSource && locationValue) {
        await this.progressRepository.recordKnownPosition(userId, sourceDeviceId, bookId, {
          locationSource,
          locationValue,
          positionSetAt: movedAt,
        });
      }
    }

    if (!protectedRegression)
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

    await this.db
      .insert(schema.koboDeviceReadingStates)
      .values({
        userId,
        deviceId: sourceDeviceId,
        bookId,
        entitlementId,
        deliveryId: uncertainDelivery ? (existing?.deliveryId ?? null) : deliveryId,
        createdAtKobo: created,
        lastModifiedKobo: effectiveLastModified,
        priorityTimestamp: effectivePriority,
        currentBookmark: mergedBookmark,
        statistics: mergedStats,
        statusInfo: mergedStatus,
      })
      .onConflictDoUpdate({
        target: [schema.koboDeviceReadingStates.userId, schema.koboDeviceReadingStates.deviceId, schema.koboDeviceReadingStates.bookId],
        set: {
          deliveryId: uncertainDelivery ? (existing?.deliveryId ?? null) : deliveryId,
          lastModifiedKobo: effectiveLastModified,
          priorityTimestamp: effectivePriority,
          currentBookmark: mergedBookmark,
          statistics: mergedStats,
          statusInfo: mergedStatus,
          updatedAt: new Date(),
        },
      });

    const sharedChanged =
      this.extractPercent(this.asJsonObj(shared?.currentBookmark)) !== mergedPercent ||
      !isDeepStrictEqual(this.asJsonObj(shared?.statistics), mergedStats) ||
      !isDeepStrictEqual(this.asJsonObj(shared?.statusInfo), mergedStatus);
    if (!protectedRegression && twoWayProgressSync && stateChanged && sharedChanged && mergedPercent !== null) {
      await this.markSnapshotBookUnsyncedForOtherDevices(userId, bookId, sourceDeviceId);
    }

    if (!protectedRegression && (bookmarkChanged || statusChanged) && mergedPercent !== null) {
      await this.autoUpdateReadStatus(userId, bookId, mergedPercent, readingThreshold, finishedThreshold, {
        occurredAt: new Date(effectiveLastModified),
        strongRereadEvidence,
      });
    }

    // After the status update, so the attempt a first push opens is already there for the
    // session to be filed against rather than landing with a null attemptId.
    if (incomingStats) {
      await this.recordStatisticsReadingSession({
        userId,
        bookId,
        sourceDeviceId,
        incomingStats,
        previousPercent: protectedRegression ? null : previousPercent,
        mergedPercent: protectedRegression ? null : mergedPercent,
        fallbackLastModified: lastModified,
      });
    }

    if (!protectedRegression && bookmarkChanged && mergedPercent !== null) {
      this.achievementEvents.emit(ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED, {
        userId,
        bookId,
        progress: mergedPercent,
        source: 'kobo',
      });
    }

    if (echoed) {
      await this.progressRepository.markDeviceBookUnsynced(userId, sourceDeviceId, bookId);
      this.logger.log(
        `[kobo.reading_state] [end] userId=${userId} deviceId=${sourceDeviceId} bookId=${bookId} durationMs=${Date.now() - startedAt} outcome=retained reason=returned_known_position - kept the newer position; the device returned the place it already held`,
      );
    } else if (protectedRegression) {
      await this.progressRepository.markDeviceBookUnsynced(userId, sourceDeviceId, bookId);
      this.logger.warn(
        `[kobo.reading_state] [end] userId=${userId} deviceId=${sourceDeviceId} bookId=${bookId} durationMs=${Date.now() - startedAt} outcome=retained reason=unattributed_backwards_bookmark - retained saved progress; device bookmark kept for review`,
      );
    }
    return buildStateUpdateResponse(entitlementId, 'Success');
  }

  /**
   * Turns the reading time a device reports alongside its bookmark into a reading session.
   *
   * Some Kobo devices no longer emit the `LeaveContent` analytics events the reading log was
   * built on, so `POST /v1/analytics/event` never arrives and every Kobo statistic reads zero
   * however much the device is read. What every device does still send, on every state push, is
   * its own `SpentReadingMinutes` - the counter it keeps as `content.TimeSpentReading` on device,
   * and the only reading time those devices offer at all. Others still send both: a Libra Colour
   * on firmware 4.45.23792 does, and after offline reading it pushes the counter and the events
   * together with its next sync, long after the reading.
   *
   * Each device has an independent durable cursor. Session insertion, daily aggregation, and
   * cursor advancement share one transaction so a failed write is retried from the same counter.
   * Measured analytics sessions and counter-derived sessions are serialized by the same lock and
   * reconciled on the counter interval each estimate stands for, regardless of which endpoint
   * arrives first.
   *
   * Failures are swallowed. A device retries the entire push when the response is not a clean
   * acknowledgement, so a session that cannot be stored must not take the bookmark down with it.
   */
  private async recordStatisticsReadingSession(params: {
    userId: number;
    bookId: number;
    sourceDeviceId: number;
    incomingStats: JsonObj;
    previousPercent: number | null;
    mergedPercent: number | null;
    fallbackLastModified: string;
  }): Promise<void> {
    const { userId, bookId, sourceDeviceId, incomingStats, previousPercent, mergedPercent } = params;

    const currentMinutes = this.extractSpentReadingMinutes(incomingStats);
    if (currentMinutes === null) return;

    const startedAtMs = Date.now();
    try {
      const resolved = await this.analyticsResolver.resolveBookFileId(userId, sourceDeviceId, bookId);
      const endedAt = this.resolveStatisticsEndedAt(incomingStats, params.fallbackLastModified);
      const result = await this.readingSessions.recordCumulativeSyncedSession({
        userId,
        bookId,
        bookFileId: resolved.kind === 'resolved' ? resolved.bookFileId : null,
        cursorSource: KOBO_STATISTICS_CURSOR_SOURCE,
        sourceDeviceKey: koboSourceDeviceKey(sourceDeviceId),
        sessionIdPrefix: koboStatisticsSessionIdPrefix(sourceDeviceId),
        buildSessionId: (bookFileId, generation, counter) => koboStatisticsSessionId(sourceDeviceId, bookFileId, generation, counter),
        counter: currentMinutes,
        endedAt,
        progressDelta: this.resolveProgressDelta(previousPercent, mergedPercent),
        endProgress: mergedPercent,
        source: 'kobo',
        timeZone: await this.findUserTimeZone(userId),
      });

      this.logger.log(
        `[${STATISTICS_SESSION_EVENT}] [end] userId=${userId} bookId=${bookId} deviceId=${sourceDeviceId} bookFileId=${resolved.kind === 'resolved' ? resolved.bookFileId : 'none'} durationMs=${Date.now() - startedAtMs} spentReadingMinutes=${currentMinutes} outcome=${result.kind}${result.kind === 'skipped' ? ` reason=${result.reason}` : ''} - device reading-time counter processed`,
      );
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(
        `[${STATISTICS_SESSION_EVENT}] [fail] userId=${userId} bookId=${bookId} durationMs=${Date.now() - startedAtMs} errorClass=${err.constructor.name} error="${sanitizeLogValue(err.message)}" - deriving a reading session from device reading time failed`,
      );
    }
  }

  /** Whole minutes only, so a fractional counter accrues across pushes rather than truncating on each. */
  private extractSpentReadingMinutes(stats: JsonObj | null): number | null {
    const value = stats?.SpentReadingMinutes;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_STATISTICS_MINUTES) return null;
    return Math.floor(value);
  }

  /** The device's own clock for the counter, held to the present so a fast clock cannot book time into tomorrow. */
  private resolveStatisticsEndedAt(stats: JsonObj | null, fallback: string): Date {
    const modified = typeof stats?.LastModified === 'string' ? stats.LastModified : undefined;
    const parsed = this.parseKoboTimestamp(modified) ?? this.parseKoboTimestamp(fallback) ?? new Date();
    const now = new Date();
    return parsed.getTime() > now.getTime() ? now : parsed;
  }

  private resolveProgressDelta(previousPercent: number | null, mergedPercent: number | null): number | null {
    if (previousPercent === null || mergedPercent === null) return null;
    return Math.round(Math.max(-100, Math.min(100, mergedPercent - previousPercent)) * 100) / 100;
  }

  private async findUserTimeZone(userId: number): Promise<string> {
    const [row] = await this.db.select({ settings: schema.users.settings }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    return resolveTimeZone((row?.settings as { timezone?: unknown } | undefined)?.timezone, 'UTC');
  }

  private async autoUpdateReadStatus(
    userId: number,
    bookId: number,
    percent: number,
    readingThreshold: number,
    finishedThreshold: number,
    activity: { occurredAt: Date; strongRereadEvidence: boolean },
  ): Promise<void> {
    const startedAt = Date.now();
    try {
      await this.userBookStatusService.autoUpdate(userId, bookId, percent, readingThreshold, finishedThreshold, {
        origin: 'kobo',
        occurredAt: activity.occurredAt,
        timeZone: await this.findUserTimeZone(userId),
        strongRereadEvidence: activity.strongRereadEvidence,
      });
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(
        `[kobo.reading_state_status_update] [fail] userId=${userId} bookId=${bookId} durationMs=${Date.now() - startedAt} errorClass=${err.constructor.name} error="${sanitizeLogValue(err.message)}" - auto status update failed`,
      );
    }
  }

  async getRawState(userId: number, bookId: number, deviceId?: number): Promise<unknown> {
    const book = await this.db.query.books.findFirst({
      where: eq(schema.books.id, bookId),
      columns: { id: true },
    });
    if (!book) return null;

    await this.bookAccessService.assertBookAccessible(userId, bookId);

    let row:
      | (Pick<
          typeof schema.koboDeviceReadingStates.$inferSelect,
          'currentBookmark' | 'statistics' | 'statusInfo' | 'createdAtKobo' | 'lastModifiedKobo' | 'priorityTimestamp'
        > & { deliveryId?: string | null })
      | undefined = deviceId
      ? await this.db.query.koboDeviceReadingStates.findFirst({
          where: and(
            eq(schema.koboDeviceReadingStates.userId, userId),
            eq(schema.koboDeviceReadingStates.deviceId, deviceId),
            eq(schema.koboDeviceReadingStates.bookId, bookId),
          ),
        })
      : await this.db.query.koboReadingStates.findFirst({
          where: and(eq(schema.koboReadingStates.userId, userId), eq(schema.koboReadingStates.bookId, bookId)),
        });

    if (row && deviceId) {
      const shared = await this.db.query.koboReadingStates.findFirst({
        where: and(eq(schema.koboReadingStates.userId, userId), eq(schema.koboReadingStates.bookId, bookId)),
        columns: { statusInfo: true },
      });
      row = { ...row, statusInfo: this.newerStatus(row.statusInfo, shared?.statusInfo) };
    } else if (!row && deviceId) {
      const shared = await this.db.query.koboReadingStates.findFirst({
        where: and(eq(schema.koboReadingStates.userId, userId), eq(schema.koboReadingStates.bookId, bookId)),
      });
      if (shared) {
        const { Location: ignoredLocation, ...bookmark } = this.asJsonObj(shared.currentBookmark) ?? {};
        void ignoredLocation;
        row = { ...shared, currentBookmark: bookmark };
      }
    }
    const initial = !row;
    if (!row) {
      const now = new Date().toISOString();
      row = { currentBookmark: null, statistics: null, statusInfo: null, createdAtKobo: now, lastModifiedKobo: null, priorityTimestamp: null };
    }

    const delivery = deviceId && this.deliveries ? await this.deliveries.current(userId, deviceId, bookId) : undefined;
    const retainSavedProgress = Boolean(
      deviceId &&
      this.deliveries &&
      (!delivery ||
        !isSettledDelivery(delivery) ||
        ('deliveryId' in row && row.deliveryId !== delivery.id) ||
        this.extractPercent(this.asJsonObj(row.currentBookmark)) === 0),
    );
    const refreshed = await this.refreshBookmarkFromHub(userId, bookId, row, deviceId, retainSavedProgress, delivery).catch((error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(
        `[kobo.reading_state_refresh] [fail] userId=${userId} bookId=${bookId} errorClass=${err.constructor.name} error="${sanitizeLogValue(err.message)}" - hub bookmark refresh failed, serving stored bookmark`,
      );
      return null;
    });

    if (initial && !refreshed) return null;
    if (initial && refreshed) {
      const percent = this.extractPercent(refreshed.bookmark) ?? 0;
      const finished = percent > 0 && (await this.reachesFinish(bookId, percent));
      row.statusInfo = {
        LastModified: refreshed.lastModifiedKobo,
        Status: finished ? 'Finished' : percent > 0 ? 'Reading' : 'ReadyToRead',
        TimesStartedReading: percent > 0 ? 1 : 0,
      };
    }
    let rawBookmark = row.currentBookmark;
    if (deviceId && (!delivery || isUnconfirmedReplacement(delivery) || ('deliveryId' in row && row.deliveryId !== delivery.id))) {
      const safe = this.asJsonObj(rawBookmark);
      if (safe) {
        const { Location: ignoredLocation, ...rest } = safe;
        void ignoredLocation;
        rawBookmark = rest;
      }
    }
    const outgoingBookmark = refreshed?.bookmark ?? rawBookmark;
    let statusInfo = row.statusInfo;
    const status = this.asJsonObj(statusInfo);
    const percent = this.extractPercent(this.asJsonObj(outgoingBookmark));
    // A position another reader carried past the library's finish mark finishes the book on the Kobo
    // too, as it does in BookOrbit. Only 100% did, and a read-along ends on its last sentence just short
    // of it, so a book finished on a phone stayed Reading on the Kobo.
    const finishedElsewhere =
      refreshed !== null && percent !== null && percent > 0 && status?.Status !== 'Finished' && (await this.reachesFinish(bookId, percent));
    if (refreshed && percent !== null && percent > 0 && (!status || status.Status === 'ReadyToRead' || finishedElsewhere)) {
      statusInfo = {
        ...(status ?? {}),
        LastModified: refreshed.lastModifiedKobo,
        Status: finishedElsewhere ? 'Finished' : 'Reading',
        TimesStartedReading: Math.max(1, typeof status?.TimesStartedReading === 'number' ? status.TimesStartedReading : 0),
      };
    }
    return {
      EntitlementId: (await this.bookIdentityService.ensureForBook(userId, bookId, await this.hasLibrarySnapshot(userId))).entitlementId,
      Created: row.createdAtKobo,
      LastModified: refreshed?.lastModifiedKobo ?? row.lastModifiedKobo,
      PriorityTimestamp: refreshed?.lastModifiedKobo ?? row.priorityTimestamp,
      CurrentBookmark: outgoingBookmark,
      Statistics: row.statistics,
      StatusInfo: statusInfo,
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
    state: { currentBookmark: unknown; lastModifiedKobo: string | null; priorityTimestamp: string | null },
    deviceId?: number,
    retainSavedProgress = false,
    delivery?: KoboDeliveryRecord | null,
  ): Promise<{ bookmark: JsonObj; lastModifiedKobo: string } | null> {
    const bookmark = this.asJsonObj(state.currentBookmark);
    const settings = await this.settingsService.getSettings(userId);
    if (!settings.twoWayProgressSync && !retainSavedProgress) return null;

    const fileId = deviceId ? await this.progressFileFor(bookId, delivery) : await this.progressRepository.findPrimaryFileId(bookId);
    if (!fileId) return null;
    const progress = await this.progressRepository.findForFile(userId, fileId);
    if (!progress || (!deviceId && progress.koboLocationValue)) return null;
    const devicePercentage = this.extractPercent(bookmark);
    if (!settings.twoWayProgressSync && devicePercentage !== null && progress.percentage <= devicePercentage) return null;

    const narration =
      progress.mediaOverlayFragment && progress.mediaOverlaySectionIndex !== null
        ? { fragment: progress.mediaOverlayFragment, sectionIndex: progress.mediaOverlaySectionIndex }
        : null;
    const point = !settings.twoWayProgressSync
      ? null
      : progress.cfi
        ? await this.progressBridge.cfiToKoboBookmark(userId, bookId, progress.cfi, deviceId)
        : narration
          ? await this.progressBridge.narrationToKoboBookmark(userId, bookId, fileId, narration, deviceId)
          : null;

    const existingLocation = this.asJsonObj(bookmark?.Location ?? null);
    const sameLocation = point && existingLocation?.Value === point.value && existingLocation?.Source === point.source;
    const samePercent = typeof bookmark?.ProgressPercent === 'number' && Math.abs(bookmark.ProgressPercent - progress.percentage) < PROGRESS_EPSILON;
    if (samePercent && (!point || sameLocation)) {
      if (point) await this.rememberServedPoint(userId, bookId, fileId, deviceId, point, progress);
      return null;
    }

    // Stamped with when the hub position was set, not when it was asked for. A device's row keeps its
    // own last push, so a request-time stamp made every fetch newer than the bookmark the Kobo had
    // just taken, and a Kobo told to follow it fetched again and asked again, without end.
    const positionSetAt =
      (progress.cfi ? progress.textUpdatedAt : narration ? progress.narrationUpdatedAt : null) ?? progress.updatedAt ?? new Date();
    const stampedIso = advanceIsoTimestamp(
      positionSetAt,
      state.lastModifiedKobo,
      state.priorityTimestamp,
      typeof bookmark?.LastModified === 'string' ? bookmark.LastModified : null,
    );
    const merged: JsonObj = {
      ...(bookmark ?? {}),
      LastModified: stampedIso,
      ProgressPercent: progress.percentage,
    };
    if (point) merged.Location = { Source: point.source, Type: 'KoboSpan', Value: point.value };
    else delete merged.Location;
    if (point?.contentSourceProgressPercent != null) merged.ContentSourceProgressPercent = point.contentSourceProgressPercent;
    else delete merged.ContentSourceProgressPercent;

    // Device state retains the last device event; a generated response is not evidence
    // that the reader applied it or started reading the delivered copy.
    if (!deviceId) {
      await this.db
        .update(schema.koboReadingStates)
        .set({ currentBookmark: merged, lastModifiedKobo: stampedIso, priorityTimestamp: stampedIso, updatedAt: new Date() })
        .where(and(eq(schema.koboReadingStates.userId, userId), eq(schema.koboReadingStates.bookId, bookId)));
    }
    if (point) await this.rememberServedPoint(userId, bookId, fileId, deviceId, point, progress);

    return { bookmark: merged, lastModifiedKobo: stampedIso };
  }

  private async rememberServedPoint(
    userId: number,
    bookId: number,
    fileId: number,
    deviceId: number | undefined,
    point: { source: string; value: string; contentSourceProgressPercent: number | null },
    progress: PositionStamps,
  ): Promise<void> {
    await this.progressRepository.stampLocation(userId, fileId, point);
    const positionSetAt = this.positionMovedAt(progress);
    if (deviceId && positionSetAt) {
      await this.progressRepository.recordKnownPosition(userId, deviceId, bookId, {
        locationSource: point.source,
        locationValue: point.value,
        positionSetAt,
      });
    }
  }

  /**
   * Whether a Kobo pushed back the place it already held, sent to it or moved to by it, after
   * another device moved the book on. Nickel restamps its bookmark whenever the book is closed, so
   * that untouched place arrives looking newer than the move made since. The place it last pushed
   * counts as well as the one last sent: a Kobo fetches the newer place before it delivers a close
   * made earlier, so by then the place sent is already the new one.
   */
  private async returnsKnownPosition(
    userId: number,
    bookId: number,
    deviceId: number,
    delivery: KoboDeliveryRecord | null | undefined,
    locationSource: string,
    locationValue: string,
    previousBookmark: JsonObj | null,
  ): Promise<boolean> {
    const known = await this.progressRepository.findKnownPosition(userId, deviceId, bookId);
    const sentAt = known?.locationSource === locationSource && known.locationValue === locationValue ? known.positionSetAt : null;
    const pushedAt =
      this.extractKoboLocationSource(previousBookmark) === locationSource && this.extractKoboLocationValue(previousBookmark) === locationValue
        ? this.parseKoboTimestamp(typeof previousBookmark?.LastModified === 'string' ? previousBookmark.LastModified : undefined)
        : null;
    if (!sentAt && !pushedAt) return false;
    const fileId = await this.progressFileFor(bookId, delivery);
    const progress = fileId ? await this.progressRepository.findForFile(userId, fileId) : null;
    const movedAt = progress ? this.positionMovedAt(progress) : null;
    if (!movedAt) return false;
    return [sentAt, pushedAt].some((heldAt) => heldAt !== null && movedAt.getTime() > heldAt.getTime());
  }

  /** When the shared position last moved, by text or narration; the row's own stamp before the split. */
  private positionMovedAt(progress: PositionStamps): Date | null {
    const stamps = [progress.textUpdatedAt, progress.narrationUpdatedAt].filter((stamp): stamp is Date => stamp instanceof Date);
    if (stamps.length === 0) return progress.updatedAt ?? null;
    return new Date(Math.max(...stamps.map((stamp) => stamp.getTime())));
  }

  /**
   * A Kobo's own row keeps the last status it reported, and a Kobo with one is served from it. A status
   * BookOrbit set since, a book marked read or unread in the app or finished on another Kobo, lands on
   * the shared row instead, so it never reached that Kobo. The newer of the two is served.
   */
  private newerStatus(device: unknown, shared: unknown): unknown {
    const own = this.asJsonObj(device);
    const hub = this.asJsonObj(shared);
    if (!hub || typeof hub.Status !== 'string' || hub.Status === own?.Status) return device;
    const hubAt = this.parseKoboTimestamp(typeof hub.LastModified === 'string' ? hub.LastModified : undefined);
    const ownAt = this.parseKoboTimestamp(typeof own?.LastModified === 'string' ? own.LastModified : undefined);
    if (!hubAt || (ownAt && hubAt.getTime() <= ownAt.getTime())) return device;
    return { ...(own ?? {}), Status: hub.Status, LastModified: hub.LastModified };
  }

  /** Whether a percentage counts as finished, by the library's finish mark that BookOrbit's read status uses. */
  private async reachesFinish(bookId: number, percent: number): Promise<boolean> {
    if (percent >= 100) return true;
    const threshold = await this.progressRepository.findFinishThreshold(bookId);
    const finishAt = threshold !== null && Number.isFinite(threshold) ? Math.min(100, Math.max(1, threshold)) : 100;
    return hasReachedProgressThreshold(percent, finishAt);
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

  /**
   * The file a device's progress is kept on: the one its copy was built from, which stops being the
   * book's primary when the library's format order or the book's files change. The device's positions
   * belong to that file, and BookOrbit's sibling sync carries progress from it to the book's other EPUBs.
   */
  private async progressFileFor(bookId: number, delivery: KoboDeliveryRecord | null | undefined): Promise<number | null> {
    const primary = await this.progressRepository.findPrimaryFileId(bookId);
    const source = delivery?.sourceFileId ?? null;
    if (source === null || source === primary) return primary;
    return (await this.progressRepository.isReaderFileOfBook(bookId, source)) ? source : primary;
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
    uncertainDelivery: boolean,
    delivery: KoboDeliveryRecord | null | undefined,
  ): Promise<'applied' | 'kept' | 'regressed'> {
    const fileId = await this.progressFileFor(bookId, delivery);
    if (!fileId) return 'kept';
    const existing = await this.progressRepository.findForFile(userId, fileId);
    if (uncertainDelivery && existing && existing.percentage > percentage + PROGRESS_EPSILON) return 'regressed';

    if (existing?.updatedAt && existing.updatedAt.getTime() >= sourceUpdatedAt.getTime()) return 'kept';
    const samePercent = existing ? Math.abs(existing.percentage - percentage) < PROGRESS_EPSILON : false;
    if (
      samePercent &&
      existing?.cfi &&
      existing.koboLocationSource === koboLocationSource &&
      existing.koboLocationType === koboLocationType &&
      existing.koboLocationValue === koboLocationValue &&
      existing.koboContentSourceProgressPercent === koboContentSourceProgressPercent
    ) {
      return 'kept';
    }
    const nextCfi = precise?.cfi ?? (samePercent ? (existing?.cfi ?? null) : null);
    const nextXpointer = precise?.xpointer ?? (samePercent ? (existing?.koreaderProgress ?? null) : null);

    const saved = await this.progressRepository.save(
      {
        userId,
        bookFileId: fileId,
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
        lastReadAt: sourceUpdatedAt,
        textUpdatedAt: sourceUpdatedAt,
      },
      uncertainDelivery,
    );
    if (!saved) {
      if (!uncertainDelivery) return 'kept';
      const current = await this.progressRepository.findForFile(userId, fileId);
      return !current || current.percentage <= percentage + PROGRESS_EPSILON ? 'kept' : 'regressed';
    }

    await this.bookService.syncAudioProgressForExternalEbookProgress(userId, bookId, fileId, percentage, {
      cfi: nextCfi,
      koreaderProgress: nextXpointer,
      sourceUpdatedAt,
    });
    return 'applied';
  }

  private async markSnapshotBookUnsyncedForOtherDevices(userId: number, bookId: number, sourceDeviceId: number): Promise<void> {
    await this.db.execute(sql`
      UPDATE ${schema.koboSnapshotBooks} AS sb
      SET synced = false,
          is_new = false
      FROM ${schema.koboLibrarySnapshots} AS snap
      WHERE snap.id = sb.snapshot_id
        AND snap.user_id = ${userId}
        AND snap.device_id <> ${sourceDeviceId}
        AND sb.book_id = ${bookId}
        AND sb.synced = true
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
