import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import {
  ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED,
  ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
  ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
  AchievementEventsService,
  type BookRatingChangedPayload,
  type BookStatusChangedPayload,
  type ReadingSessionSavedPayload,
} from '../achievement/achievement-events.service';
import { HardcoverRepository } from './hardcover.repository';
import { HardcoverSettingsService } from './hardcover-settings.service';
import { HardcoverSyncService } from './hardcover-sync.service';

@Injectable()
export class HardcoverEventListener implements OnModuleInit {
  private readonly logger = new Logger(HardcoverEventListener.name);

  constructor(
    private readonly achievementEvents: AchievementEventsService,
    private readonly settingsService: HardcoverSettingsService,
    private readonly syncService: HardcoverSyncService,
    private readonly repository: HardcoverRepository,
  ) {}

  onModuleInit() {
    this.achievementEvents.on(ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, (payload: BookStatusChangedPayload) => {
      void this.handleStatusChanged(payload);
    });

    this.achievementEvents.on(ACHIEVEMENT_EVENT_READING_SESSION_SAVED, (payload: ReadingSessionSavedPayload) => {
      void this.handleReadingSessionSaved(payload);
    });

    this.achievementEvents.on(ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED, (payload: BookRatingChangedPayload) => {
      void this.handleRatingChanged(payload);
    });
  }

  private async handleStatusChanged(payload: BookStatusChangedPayload): Promise<void> {
    const settings = await this.settingsService.getSettings(payload.userId);
    if (!settings.tokenConfigured || !settings.enabled || !settings.autoSyncOnStatusChange) return;
    if (!(await this.settingsService.isFeatureEnabled())) return;

    try {
      await this.syncService.syncBook(payload.userId, payload.bookId);
    } catch {
      this.logger.warn(`[hardcover.event_listener] userId=${payload.userId} bookId=${payload.bookId} event=status_changed - sync failed silently`);
    }
  }

  private async handleReadingSessionSaved(payload: ReadingSessionSavedPayload): Promise<void> {
    const settings = await this.settingsService.getSettings(payload.userId);
    if (!settings.tokenConfigured || !settings.enabled || !settings.autoSyncOnProgressUpdate) return;
    if (!(await this.settingsService.isFeatureEnabled())) return;

    const bookId = await this.repository.findBookIdByFileId(payload.bookFileId);
    if (!bookId) return;

    try {
      await this.syncService.syncBook(payload.userId, bookId);
    } catch {
      this.logger.warn(
        `[hardcover.event_listener] userId=${payload.userId} bookFileId=${payload.bookFileId} event=reading_session_saved - sync failed silently`,
      );
    }
  }

  private async handleRatingChanged(payload: BookRatingChangedPayload): Promise<void> {
    const settings = await this.settingsService.getSettings(payload.userId);
    if (!settings.tokenConfigured || !settings.enabled || !settings.autoSyncOnRatingChange) return;
    if (!(await this.settingsService.isFeatureEnabled())) return;

    for (const bookId of payload.bookIds) {
      try {
        await this.syncService.syncBook(payload.userId, bookId);
      } catch {
        this.logger.warn(`[hardcover.event_listener] userId=${payload.userId} bookId=${bookId} event=rating_changed - sync failed silently`);
      }
    }
  }
}
