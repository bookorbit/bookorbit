import { Injectable, Logger } from '@nestjs/common';

import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import type { RequestUser } from '../../../common/types/request-user';
import { ReadingSessionService } from '../../reading-session/reading-session.service';
import type { KoboDeviceContext } from '../guards/kobo-token.guard';
import type { KoboAnalyticsBody, KoboAnalyticsEvent } from '../kobo-analytics.types';
import { KoboBookIdentityService } from './kobo-book-identity.service';
import { KoboAnalyticsResolverService } from './kobo-analytics-resolver.service';

const DEBUG_PAYLOAD_MAX_LENGTH = 4000;

function parseKoboEndProgress(raw: string | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number.parseFloat(trimmed);
  return Number.isFinite(value) ? value : null;
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
  ) {}

  async ingest(body: KoboAnalyticsBody | null | undefined, user: RequestUser, device: KoboDeviceContext): Promise<void> {
    const events = this.normalizeEvents(body, user.id);
    this.logBatch(body, events, user.id, device.deviceId);

    for (const ev of events) {
      if (ev.EventType !== 'LeaveContent') continue;
      try {
        await this.handleLeaveContent(ev, user);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        this.logger.warn(
          `[kobo.analytics.session] [fail] userId=${user.id} eventId=${ev.Id} error="${message}" event="${formatAnalyticsPayload(ev, 800)}" - leave content ingest failed`,
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

  private async handleLeaveContent(ev: KoboAnalyticsEvent, user: RequestUser): Promise<void> {
    const volumeid = ev.Attributes?.volumeid;
    const seconds = ev.Metrics?.SecondsRead;
    if (typeof volumeid !== 'string' || volumeid.length === 0 || typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
      this.logger.debug(
        `[kobo.analytics.session] [ignore] malformed LeaveContent userId=${user.id} eventId=${ev.Id} event="${formatAnalyticsPayload(ev, 800)}"`,
      );
      return;
    }

    const trimmedVolumeId = volumeid.trim();
    const bookId = await this.bookIdentityService.resolveBookIdByEntitlementId(user.id, trimmedVolumeId);
    if (bookId === null) {
      this.logger.debug(
        `[kobo.analytics.session] [ignore] invalid volumeid userId=${user.id} eventId=${ev.Id} volumeid="${sanitizeLogValue(volumeid)}" event="${formatAnalyticsPayload(ev, 800)}"`,
      );
      return;
    }

    const durationSeconds = Math.floor(seconds);

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

    const startedAt = new Date(endedAt.getTime() - durationSeconds * 1000);

    await this.readingSessionService.save(
      resolved.bookFileId,
      {
        sessionId: ev.Id,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationSeconds,
        progressDelta: null,
        endProgress: parseKoboEndProgress(ev.Attributes?.progress),
      },
      user,
    );
  }
}
