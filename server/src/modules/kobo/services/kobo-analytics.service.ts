import { Injectable, Logger } from '@nestjs/common';

import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import type { RequestUser } from '../../../common/types/request-user';
import { BookService } from '../../book/book.service';
import { ReadingSessionService } from '../../reading-session/reading-session.service';
import type { KoboDeviceContext } from '../guards/kobo-token.guard';
import type { KoboAnalyticsBody, KoboAnalyticsEvent } from '../kobo-analytics.types';
import { KoboBookIdentityService } from './kobo-book-identity.service';
import { KoboAnalyticsResolverService } from './kobo-analytics-resolver.service';

const DEBUG_PAYLOAD_MAX_LENGTH = 4000;

type LeaveContentContext = {
  progressDelta: number | null;
  startedAtMs: number | null;
};

function parseKoboProgress(raw: unknown): number | null {
  if (raw == null) return null;
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw.trim()) : Number.NaN;
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return value;
}

type KoboStarsValue = { kind: 'rating'; value: number } | { kind: 'clear' } | { kind: 'invalid' };

function parseKoboStars(metrics: KoboAnalyticsEvent['Metrics'] | undefined): KoboStarsValue {
  if (metrics?.stars === undefined) return { kind: 'invalid' };

  const stars = metrics.stars;
  if (typeof stars !== 'number' || !Number.isInteger(stars)) return { kind: 'invalid' };
  if (stars === 0) return { kind: 'clear' };
  if (stars >= 1 && stars <= 5) return { kind: 'rating', value: stars };
  return { kind: 'invalid' };
}

function parseKoboDurationSeconds(metrics: KoboAnalyticsEvent['Metrics'] | undefined): number | null {
  const secondsRead = metrics?.SecondsRead;
  if (typeof secondsRead !== 'number' || !Number.isFinite(secondsRead) || secondsRead < 0) return null;

  const idleTime = metrics?.IdleTime;
  const activeSeconds =
    typeof idleTime === 'number' && Number.isFinite(idleTime) && idleTime >= 0 ? Math.max(0, secondsRead - idleTime) : secondsRead;

  return Math.floor(activeSeconds);
}

function formatAnalyticsPayload(value: unknown, maxLength = DEBUG_PAYLOAD_MAX_LENGTH): string {
  try {
    return sanitizeLogValue(JSON.stringify(value), maxLength);
  } catch {
    return sanitizeLogValue(String(value), maxLength);
  }
}

function summarizeEventTypes(events: KoboAnalyticsEvent[]): string {
  const counts = new Map<string, number>();
  for (const ev of events) {
    const type = typeof ev.EventType === 'string' ? ev.EventType : '(missing)';
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts.entries()].map(([type, count]) => `${type}:${count}`).join(', ');
}

@Injectable()
export class KoboAnalyticsService {
  private readonly logger = new Logger(KoboAnalyticsService.name);

  constructor(
    private readonly bookIdentityService: KoboBookIdentityService,
    private readonly resolver: KoboAnalyticsResolverService,
    private readonly readingSessionService: ReadingSessionService,
    private readonly bookService: BookService,
  ) {}

  async ingest(body: KoboAnalyticsBody | null | undefined, user: RequestUser, device: KoboDeviceContext): Promise<void> {
    const events = this.normalizeEvents(body, user.id);
    this.logBatch(body, events, user.id, device.deviceId);
    const leaveContentContexts = this.buildLeaveContentContexts(events);

    for (const ev of events) {
      try {
        if (ev.EventType === 'LeaveContent') {
          await this.handleLeaveContent(ev, user, leaveContentContexts.get(ev) ?? { progressDelta: null, startedAtMs: null });
        } else if (ev.EventType === 'RateBook') {
          await this.handleRateBook(ev, user);
        }
      } catch (err) {
        const message = sanitizeLogValue(err instanceof Error ? err.message : 'unknown error');
        const kind = ev.EventType === 'RateBook' ? 'rating' : 'session';
        this.logger.warn(
          `[kobo.analytics.${kind}] [fail] userId=${user.id} eventId=${ev.Id} error="${message}" event="${formatAnalyticsPayload(ev, 800)}" - analytics ingest failed`,
        );
      }
    }
  }

  private normalizeEvents(body: KoboAnalyticsBody | null | undefined, userId: number): KoboAnalyticsEvent[] {
    if (body?.Events == null) return [];
    if (!Array.isArray(body.Events)) {
      this.logger.warn(`[kobo.analytics] invalid Events envelope userId=${userId} payload="${formatAnalyticsPayload(body)}" - expected an array`);
      return [];
    }
    return body.Events;
  }

  private logBatch(body: KoboAnalyticsBody | null | undefined, events: KoboAnalyticsEvent[], userId: number, deviceId: number): void {
    const typeSummary = events.length > 0 ? summarizeEventTypes(events) : 'none';
    this.logger.debug(
      `[kobo.analytics] batch userId=${userId} deviceId=${deviceId} eventCount=${events.length} types=${typeSummary} payload="${formatAnalyticsPayload(body)}"`,
    );
  }

  private async handleRateBook(ev: KoboAnalyticsEvent, user: RequestUser): Promise<void> {
    const volumeid = this.extractVolumeId(ev);
    const stars = parseKoboStars(ev.Metrics);
    if (volumeid === null || stars.kind === 'invalid') {
      this.logger.debug(
        `[kobo.analytics.rating] [ignore] malformed RateBook userId=${user.id} eventId=${ev.Id} event="${formatAnalyticsPayload(ev, 800)}"`,
      );
      return;
    }

    const bookId = await this.bookIdentityService.resolveBookIdByEntitlementId(user.id, volumeid);
    if (bookId === null) {
      this.logger.debug(
        `[kobo.analytics.rating] [ignore] invalid volumeid userId=${user.id} eventId=${ev.Id} volumeid="${sanitizeLogValue(volumeid)}" event="${formatAnalyticsPayload(ev, 800)}"`,
      );
      return;
    }

    const rating = stars.kind === 'clear' ? null : stars.value;
    await this.bookService.bulkSetRating([bookId], rating, user);
  }

  private async handleLeaveContent(ev: KoboAnalyticsEvent, user: RequestUser, context: LeaveContentContext): Promise<void> {
    const volumeid = this.extractVolumeId(ev);
    const durationSeconds = parseKoboDurationSeconds(ev.Metrics);
    if (volumeid === null || durationSeconds === null) {
      this.logger.debug(
        `[kobo.analytics.session] [ignore] malformed LeaveContent userId=${user.id} eventId=${ev.Id} event="${formatAnalyticsPayload(ev, 800)}"`,
      );
      return;
    }

    const bookId = await this.bookIdentityService.resolveBookIdByEntitlementId(user.id, volumeid);
    if (bookId === null) {
      this.logger.debug(
        `[kobo.analytics.session] [ignore] invalid volumeid userId=${user.id} eventId=${ev.Id} volumeid="${sanitizeLogValue(volumeid)}" event="${formatAnalyticsPayload(ev, 800)}"`,
      );
      return;
    }

    const resolved = await this.resolver.resolveBookFileId(user.id, bookId);
    if (resolved.kind !== 'resolved') {
      this.logger.log(`[kobo.analytics.session] [skip] bookId=${bookId} userId=${user.id} reason=${resolved.reason}`);
      return;
    }

    const endedAt = new Date(ev.Timestamp);
    if (Number.isNaN(endedAt.getTime())) {
      this.logger.debug(
        `[kobo.analytics.session] [ignore] invalid timestamp userId=${user.id} eventId=${ev.Id} event="${formatAnalyticsPayload(ev, 800)}"`,
      );
      return;
    }

    const startedAt =
      context.startedAtMs !== null && context.startedAtMs <= endedAt.getTime()
        ? new Date(context.startedAtMs)
        : new Date(endedAt.getTime() - durationSeconds * 1000);

    await this.readingSessionService.save(
      resolved.bookFileId,
      {
        sessionId: ev.Id,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationSeconds,
        progressDelta: context.progressDelta,
        endProgress: parseKoboProgress(ev.Attributes?.progress),
      },
      user,
      'kobo',
    );
  }

  private buildLeaveContentContexts(events: KoboAnalyticsEvent[]): Map<KoboAnalyticsEvent, LeaveContentContext> {
    const latestOpenByVolumeId = new Map<string, KoboAnalyticsEvent>();
    const leaveContentContexts = new Map<KoboAnalyticsEvent, LeaveContentContext>();

    for (const ev of this.sortEventsByTimestamp(events)) {
      const volumeid = this.extractVolumeId(ev);
      if (volumeid === null) continue;

      if (ev.EventType === 'OpenContent') {
        latestOpenByVolumeId.set(volumeid, ev);
        continue;
      }

      if (ev.EventType !== 'LeaveContent') continue;

      const openEvent = latestOpenByVolumeId.get(volumeid);
      leaveContentContexts.set(ev, {
        progressDelta: this.calculateProgressDelta(openEvent, ev),
        startedAtMs: openEvent ? this.parseTimestampMs(openEvent.Timestamp) : null,
      });
      latestOpenByVolumeId.delete(volumeid);
    }

    return leaveContentContexts;
  }

  private calculateProgressDelta(openEvent: KoboAnalyticsEvent | undefined, leaveEvent: KoboAnalyticsEvent): number | null {
    if (!openEvent) return null;

    const startProgress = parseKoboProgress(openEvent.Attributes?.progress);
    const endProgress = parseKoboProgress(leaveEvent.Attributes?.progress);
    if (startProgress === null || endProgress === null) return null;

    return Number((endProgress - startProgress).toFixed(4));
  }

  private extractVolumeId(ev: KoboAnalyticsEvent): string | null {
    const volumeid = ev.Attributes?.volumeid;
    if (typeof volumeid !== 'string') return null;

    const trimmed = volumeid.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private sortEventsByTimestamp(events: KoboAnalyticsEvent[]): KoboAnalyticsEvent[] {
    return events
      .map((event, index) => ({
        event,
        index,
        timestampMs: this.parseTimestampMs(event.Timestamp),
      }))
      .sort((a, b) => {
        if (a.timestampMs === null && b.timestampMs === null) return a.index - b.index;
        if (a.timestampMs === null) return 1;
        if (b.timestampMs === null) return -1;
        return a.timestampMs - b.timestampMs || a.index - b.index;
      })
      .map(({ event }) => event);
  }

  private parseTimestampMs(value: unknown): number | null {
    if (typeof value !== 'string') return null;

    const timestampMs = Date.parse(value);
    return Number.isNaN(timestampMs) ? null : timestampMs;
  }
}
