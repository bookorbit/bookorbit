import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import {
  ACHIEVEMENT_EVENT_BOOK_HARDCOVER_EDITION_CHANGED,
  ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED,
  ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED,
  ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
  ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
  AchievementEventsService,
  type BookHardcoverEditionChangedPayload,
  type BookProgressChangedPayload,
  type BookRatingChangedPayload,
  type BookStatusChangedPayload,
  type ReadingSessionSavedPayload,
} from '../achievement/achievement-events.service';
import { HardcoverAutoSyncSchedulerService } from './hardcover-auto-sync-scheduler.service';
import { HardcoverRepository } from './hardcover.repository';

@Injectable()
export class HardcoverEventListener implements OnModuleInit {
  private readonly logger = new Logger(HardcoverEventListener.name);

  constructor(
    private readonly achievementEvents: AchievementEventsService,
    private readonly scheduler: HardcoverAutoSyncSchedulerService,
    private readonly repo: HardcoverRepository,
  ) {}

  onModuleInit() {
    this.achievementEvents.on(ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, (payload: BookStatusChangedPayload) => {
      void this.handleStatusChanged(payload);
    });

    this.achievementEvents.on(ACHIEVEMENT_EVENT_READING_SESSION_SAVED, (payload: ReadingSessionSavedPayload) => {
      this.handleReadingSessionSaved(payload);
    });

    this.achievementEvents.on(ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED, (payload: BookProgressChangedPayload) => {
      this.handleProgressChanged(payload);
    });

    this.achievementEvents.on(ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED, (payload: BookRatingChangedPayload) => {
      this.handleRatingChanged(payload);
    });

    this.achievementEvents.on(ACHIEVEMENT_EVENT_BOOK_HARDCOVER_EDITION_CHANGED, (payload: BookHardcoverEditionChangedPayload) => {
      void this.handleHardcoverEditionChanged(payload);
    });
  }

  private handleStatusChanged(payload: BookStatusChangedPayload): void {
    this.scheduler.requestSync({ userId: payload.userId, bookId: payload.bookId, reason: 'status' });
  }

  private handleReadingSessionSaved(payload: ReadingSessionSavedPayload): void {
    this.scheduler.requestSyncForBookFile({ userId: payload.userId, bookFileId: payload.bookFileId, reason: 'progress' });
  }

  private handleProgressChanged(payload: BookProgressChangedPayload): void {
    this.scheduler.requestSync({ userId: payload.userId, bookId: payload.bookId, reason: 'progress' });
  }

  private handleRatingChanged(payload: BookRatingChangedPayload): void {
    for (const bookId of payload.bookIds) {
      this.scheduler.requestSync({ userId: payload.userId, bookId, reason: 'rating' });
    }
  }

  private async handleHardcoverEditionChanged(payload: BookHardcoverEditionChangedPayload): Promise<void> {
    if (!/^\d+$/.test(payload.hardcoverEditionId)) return;
    const editionId = Number(payload.hardcoverEditionId);
    if (!Number.isSafeInteger(editionId)) return;

    const startedAt = Date.now();
    try {
      await this.repo.updateEditionIfLinked(payload.userId, payload.bookId, editionId);
    } catch (err) {
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[hardcover.propagate_edition] [fail] userId=${payload.userId} bookId=${payload.bookId} durationMs=${Date.now() - startedAt} errorClass=${err?.constructor?.name ?? 'Error'} error="${error}" - propagating metadata edition id to sync state failed`,
      );
    }
  }
}
