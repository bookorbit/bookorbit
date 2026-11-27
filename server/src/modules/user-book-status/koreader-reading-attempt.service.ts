import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type { ReadingAttemptRow } from '../../db/schema';
import { hasReachedProgressThreshold, isMeaningfulReadingSession } from '../../common/utils/progress-threshold.utils';
import { addDateKeyDays } from '../../common/utils/reading-daily-stats.utils';
import { toDateKeyInTimeZone, toTimeZoneStartOfDay } from '../../common/utils/timezone.utils';
import { ReadingAttemptRepository, type AttemptTransaction } from './reading-attempt.repository';
import { ReadingAttemptEventsService } from './reading-attempt-events.service';
import { AchievementEventsService, ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED } from '../achievement/achievement-events.service';

type StatsSession = {
  sessionId: string;
  priorAttemptId?: number;
  startedAt: Date;
  endedAt: Date;
  startsAtOpeningPage: boolean;
  durationSeconds: number;
  progressDelta: number | null;
  endProgress: number | null;
};

type BookScope = { userId: number; bookId: number; libraryId: number; bookFileId: number; deviceId: string; timeZone: string };

@Injectable()
export class KoreaderReadingAttemptService {
  constructor(
    private readonly repo: ReadingAttemptRepository,
    private readonly events: ReadingAttemptEventsService,
    private readonly achievements: AchievementEventsService,
  ) {}

  async recordUpload<T extends { insertedSessions: StatsSession[]; updatedSessions: StatsSession[] }>(
    scope: BookScope,
    persist: (tx: AttemptTransaction) => Promise<T>,
  ): Promise<T> {
    const { userId, bookId } = scope;
    const { result, change, linksChanged } = await this.repo.bookTransaction(userId, bookId, async (tx) => {
      const result = await persist(tx);
      const sessions = [...result.insertedSessions, ...result.updatedSessions];
      if (!sessions.length) return { result, change: null, linksChanged: false };

      sessions.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
      const change = await this.applyRereads(tx, scope, sessions);
      const linksChanged = await this.repo.linkDatedStats(
        tx,
        userId,
        bookId,
        sessions.map((s) => s.sessionId),
        scope.timeZone,
      );
      return { result, change, linksChanged };
    });
    if (change || linksChanged) this.events.notifyChanged(userId);
    if (change && change.previousStatus !== change.newStatus) {
      this.achievements.emit(ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, { userId, bookId, ...change });
    }
    return result;
  }

  private async applyRereads(tx: AttemptTransaction, scope: BookScope, sessions: StatsSession[]) {
    const { userId, bookId, libraryId, timeZone } = scope;
    let attempt = (await this.repo.findActive(tx, userId, bookId)) ?? (await this.repo.findLatest(tx, userId, bookId));
    if (!attempt) return null;
    const projection = await this.repo.findStatus(tx, userId, bookId);
    if (projection?.status !== 'read' && projection?.status !== 'rereading') return null;
    const finishThreshold = await this.repo.finishThreshold(tx, libraryId);
    const preceding = attempt.outcome === null ? await this.repo.findLatest(tx, userId, bookId, attempt.id) : null;
    let changed = false;

    for (const session of sessions) {
      if (session.endProgress === null) continue;
      const startedOn = toDateKeyInTimeZone(session.startedAt, timeZone);
      const finished = hasReachedProgressThreshold(session.endProgress, finishThreshold);
      const owner = session.priorAttemptId;
      if (owner != null && (attempt.id !== owner || attempt.outcome !== null)) continue;

      // Offline devices can deliver the opening only after the middle and end of the reread.
      // Extend an inferred start only when its first linked sitting corroborates the same progression.
      if (attempt.startedOn && startedOn < attempt.startedOn) {
        if (attempt.origin === 'koreader' && projection.source === 'auto' && session.startsAtOpeningPage && !finished && owner == null) {
          const extended = await this.extendEarlierOpening(tx, scope, attempt, session, startedOn);
          if (extended) {
            attempt = extended;
            changed = true;
          }
        }
        continue;
      }
      let end = finished ? session.endedAt : null;
      if (attempt.outcome !== null) {
        if (attempt.outcome !== 'completed' || !attempt.endedOn || startedOn <= attempt.endedOn) continue;
        const read = await this.identifyReread(tx, scope, session, attempt.endedOn, finishThreshold, finished);
        if (!read) continue;
        attempt = await this.repo.createActive(tx, { userId, bookId, startedOn: toDateKeyInTimeZone(read.start, timeZone), origin: 'koreader' });
        changed = true;
        await this.repo.attachPendingStats(tx, userId, bookId, attempt.id, read.start, read.finish?.startedAt ?? session.startedAt);
        end = read.finish?.endedAt ?? end;
      } else if (!attempt.startedOn || (owner == null && preceding?.endedOn && startedOn <= preceding.endedOn)) {
        continue;
      }

      if (end) {
        const completed = await this.repo.update(tx, userId, bookId, attempt.id, {
          outcome: 'completed',
          endedOn: toDateKeyInTimeZone(end, timeZone),
        });
        if (!completed) throw new InternalServerErrorException('Locked reading attempt disappeared');
        attempt = completed;
        changed = true;
      }
    }
    if (!changed) return null;
    const newStatus = attempt.outcome === 'completed' ? 'read' : 'rereading';
    await this.repo.project(tx, userId, bookId, {
      status: newStatus,
      source: 'auto',
      startedAt: attempt.startedOn ? new Date(attempt.startedOn + 'T00:00:00Z') : null,
      finishedAt: attempt.endedOn ? new Date(attempt.endedOn + 'T00:00:00Z') : null,
    });
    return { previousStatus: projection.status, newStatus } as const;
  }

  private async identifyReread(
    tx: AttemptTransaction,
    scope: BookScope,
    session: StatsSession,
    previousEnd: string,
    threshold: number,
    finished: boolean,
  ) {
    const meaningful = isMeaningfulReadingSession(session.durationSeconds, session.progressDelta);
    if (!meaningful && !session.startsAtOpeningPage) return null;
    const earlierOpening = session.startsAtOpeningPage
      ? undefined
      : await this.repo.precedingStatsOpening(tx, scope, toTimeZoneStartOfDay(addDateKeyDays(previousEnd, 1), scope.timeZone), session.startedAt);
    // A final-page visit alone cannot distinguish a reread from a spot check.
    if (finished && (!(session.startsAtOpeningPage || earlierOpening) || (session.progressDelta ?? 0) < 1)) return null;
    const start = earlierOpening ?? session.startedAt;
    const finish = await this.repo.findPendingStatsFinish(tx, scope.userId, scope.bookId, start, threshold);
    // The finish can already be in the log when the opening arrives last.
    if (!meaningful && (finish?.progressDelta ?? 0) < 1) return null;
    return { start, finish };
  }

  private async extendEarlierOpening(tx: AttemptTransaction, scope: BookScope, attempt: ReadingAttemptRow, session: StatsSession, startedOn: string) {
    const { userId, bookId, bookFileId, timeZone } = scope;
    const previous = await this.repo.findLatest(tx, userId, bookId, attempt.id);
    if (previous?.outcome !== 'completed' || !previous.endedOn || startedOn <= previous.endedOn) return null;
    const first = await this.repo.firstAttemptSession(tx, userId, bookId, attempt.id);
    if (
      first?.source !== 'koreader' ||
      first.bookFileId !== bookFileId ||
      first.startProgress == null ||
      toDateKeyInTimeZone(first.startedAt, timeZone) !== attempt.startedOn ||
      session.endProgress === null ||
      session.endProgress > first.startProgress
    ) {
      return null;
    }
    await this.repo.attachPendingStats(tx, userId, bookId, attempt.id, session.startedAt, first.startedAt);
    return this.repo.update(tx, userId, bookId, attempt.id, { startedOn });
  }
}
