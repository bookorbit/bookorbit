import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import type { UserSettings } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { resolveTimeZone } from '../../common/utils/timezone.utils';
import {
  ACHIEVEMENT_EVENT_BACKFILL,
  ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
  AchievementEventsService,
} from '../achievement/achievement-events.service';
import type { PageStatsUploadDto } from './dto';
import { KoreaderPluginRepository } from './koreader-plugin.repository';
import { KoreaderRepository } from './koreader.repository';
import { KOREADER_BACKFILL_EVENT_THRESHOLD, type DerivedKoreaderSession } from './koreader-stats.util';

const PAGE_STATS_EVENT = 'koreader.plugin.page_stats';
const MAX_EVENTS_PER_REQUEST = 500;

export interface PageStatsBookResult {
  hash: string;
  accepted: number;
  duplicates: number;
  watermark: number;
}

export interface PageStatsUploadResult {
  results: PageStatsBookResult[];
  unmatched: string[];
}

@Injectable()
export class KoreaderStatsService {
  private readonly logger = new Logger(KoreaderStatsService.name);

  constructor(
    private readonly koreaderRepo: KoreaderRepository,
    private readonly pluginRepo: KoreaderPluginRepository,
    private readonly achievementEvents: AchievementEventsService,
  ) {}

  async uploadPageStats(user: RequestUser, dto: PageStatsUploadDto): Promise<PageStatsUploadResult> {
    const startedAtMs = Date.now();
    const totalEvents = dto.books.reduce((sum, book) => sum + book.events.length, 0);
    this.logger.log(
      `[${PAGE_STATS_EVENT}] [start] userId=${user.id} deviceId=${dto.deviceId.slice(0, 8)} books=${dto.books.length} events=${totalEvents} - page stats upload started`,
    );

    try {
      if (totalEvents > MAX_EVENTS_PER_REQUEST) {
        throw new BadRequestException(`Too many page stat events in one request (max ${MAX_EVENTS_PER_REQUEST})`);
      }

      const accessibleLibraryIds = await this.koreaderRepo.getAccessibleLibraryIds(user.id);
      const timeZone = resolveTimeZone((user.settings as unknown as UserSettings | undefined)?.timezone, 'UTC');
      const hashes = [...new Set(dto.books.map((book) => book.hash.toLowerCase()))];
      const matches = await this.koreaderRepo.resolveBookFilesByHashes(hashes, accessibleLibraryIds);

      const results: PageStatsBookResult[] = [];
      const unmatched: string[] = [];
      const insertedSessions: { session: DerivedKoreaderSession; bookFileId: number }[] = [];
      let acceptedTotal = 0;

      for (const book of dto.books) {
        const hash = book.hash.toLowerCase();
        const match = matches.get(hash);
        if (!match) {
          unmatched.push(hash);
          continue;
        }

        const result = await this.pluginRepo.ingestAndDeriveForBook({
          userId: user.id,
          bookFileId: match.bookFileId,
          bookId: match.bookId,
          libraryId: match.libraryId,
          deviceId: dto.deviceId,
          events: book.events,
          timeZone,
        });

        acceptedTotal += result.accepted;
        for (const session of result.insertedSessions) {
          insertedSessions.push({ session, bookFileId: match.bookFileId });
        }

        // Watermark covers every event processed in this batch, duplicates included, so a plugin
        // that lost its local state still advances past history the server already has.
        const watermark = book.events.reduce((max, event) => Math.max(max, event.startTime), 0);
        results.push({ hash, accepted: result.accepted, duplicates: result.duplicates, watermark });
      }

      this.emitSessionAchievements(user, insertedSessions);

      this.logger.log(
        `[${PAGE_STATS_EVENT}] [end] userId=${user.id} deviceId=${dto.deviceId.slice(0, 8)} durationMs=${Date.now() - startedAtMs} accepted=${acceptedTotal} sessionsInserted=${insertedSessions.length} unmatched=${unmatched.length} - page stats upload completed`,
      );

      return { results, unmatched };
    } catch (error) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      this.logger.warn(
        `[${PAGE_STATS_EVENT}] [fail] userId=${user.id} deviceId=${dto.deviceId.slice(0, 8)} durationMs=${Date.now() - startedAtMs} errorClass=${errorClass} error="${sanitizeLogValue(error instanceof Error ? error.message : 'unknown error')}" - page stats upload failed`,
      );
      throw error;
    }
  }

  private emitSessionAchievements(user: RequestUser, inserted: { session: DerivedKoreaderSession; bookFileId: number }[]) {
    if (inserted.length === 0) return;

    if (inserted.length > KOREADER_BACKFILL_EVENT_THRESHOLD) {
      this.achievementEvents.emit(ACHIEVEMENT_EVENT_BACKFILL, { userId: user.id });
      return;
    }

    const timezone = resolveTimeZone((user.settings as unknown as UserSettings | undefined)?.timezone, 'UTC');
    for (const { session, bookFileId } of inserted) {
      this.achievementEvents.emit(ACHIEVEMENT_EVENT_READING_SESSION_SAVED, {
        userId: user.id,
        bookFileId,
        durationSeconds: session.durationSeconds,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        progressDelta: session.progressDelta,
        endProgress: session.endProgress,
        timezone,
      });
    }
  }
}
