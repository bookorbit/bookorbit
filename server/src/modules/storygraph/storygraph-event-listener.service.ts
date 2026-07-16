import { Injectable, OnModuleInit } from '@nestjs/common';

import {
  ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED,
  ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
  ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
  AchievementEventsService,
  type BookProgressChangedPayload,
  type BookStatusChangedPayload,
  type ReadingSessionSavedPayload,
} from '../achievement/achievement-events.service';
import { StorygraphAutoSyncSchedulerService } from './storygraph-auto-sync-scheduler.service';

@Injectable()
export class StorygraphEventListener implements OnModuleInit {
  constructor(
    private readonly achievementEvents: AchievementEventsService,
    private readonly scheduler: StorygraphAutoSyncSchedulerService,
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
}
