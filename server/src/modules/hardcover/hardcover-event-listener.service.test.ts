import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED,
  ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
  ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
  AchievementEventsService,
} from '../achievement/achievement-events.service';
import { HardcoverEventListener } from './hardcover-event-listener.service';

const mockSettingsService = {
  getSettings: vi.fn(),
  isFeatureEnabled: vi.fn(),
};

const mockSyncService = {
  syncBook: vi.fn(),
};

const mockRepository = {
  findBookIdByFileId: vi.fn().mockResolvedValue(42),
};

function makeListener() {
  const events = new AchievementEventsService();
  const listener = new HardcoverEventListener(events, mockSettingsService as any, mockSyncService as any, mockRepository as any);
  listener.onModuleInit();
  return { events, listener };
}

const enabledSettings = {
  tokenConfigured: true,
  enabled: true,
  autoSyncOnStatusChange: true,
  autoSyncOnProgressUpdate: true,
  autoSyncOnRatingChange: true,
  privacySettingId: 3,
};

describe('HardcoverEventListener', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsService.isFeatureEnabled.mockResolvedValue(true);
    mockSyncService.syncBook.mockResolvedValue(undefined);
    mockRepository.findBookIdByFileId.mockResolvedValue(42);
  });

  describe('status changed event', () => {
    it('syncs book on status change when enabled', async () => {
      mockSettingsService.getSettings.mockResolvedValue(enabledSettings);
      const { events } = makeListener();
      events.emit(ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, { userId: 1, bookId: 10, newStatus: 'reading', previousStatus: 'unread' });
      await new Promise((r) => setTimeout(r, 10));
      expect(mockSyncService.syncBook).toHaveBeenCalledWith(1, 10);
    });

    it('skips when feature disabled', async () => {
      mockSettingsService.getSettings.mockResolvedValue(enabledSettings);
      mockSettingsService.isFeatureEnabled.mockResolvedValue(false);
      const { events } = makeListener();
      events.emit(ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, { userId: 1, bookId: 10, newStatus: 'reading', previousStatus: 'unread' });
      await new Promise((r) => setTimeout(r, 10));
      expect(mockSyncService.syncBook).not.toHaveBeenCalled();
    });

    it('skips when token not configured', async () => {
      mockSettingsService.getSettings.mockResolvedValue({ ...enabledSettings, tokenConfigured: false });
      const { events } = makeListener();
      events.emit(ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, { userId: 1, bookId: 10, newStatus: 'reading', previousStatus: 'unread' });
      await new Promise((r) => setTimeout(r, 10));
      expect(mockSyncService.syncBook).not.toHaveBeenCalled();
    });

    it('skips when autoSyncOnStatusChange disabled', async () => {
      mockSettingsService.getSettings.mockResolvedValue({ ...enabledSettings, autoSyncOnStatusChange: false });
      const { events } = makeListener();
      events.emit(ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, { userId: 1, bookId: 10, newStatus: 'reading', previousStatus: 'unread' });
      await new Promise((r) => setTimeout(r, 10));
      expect(mockSyncService.syncBook).not.toHaveBeenCalled();
    });

    it('does not throw when sync fails', async () => {
      mockSettingsService.getSettings.mockResolvedValue(enabledSettings);
      mockSyncService.syncBook.mockRejectedValue(new Error('API error'));
      const { events } = makeListener();
      events.emit(ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, { userId: 1, bookId: 10, newStatus: 'reading', previousStatus: 'unread' });
      await new Promise((r) => setTimeout(r, 10));
    });
  });

  describe('reading session saved event', () => {
    it('resolves bookId from bookFileId and syncs', async () => {
      mockSettingsService.getSettings.mockResolvedValue(enabledSettings);
      const { events } = makeListener();
      events.emit(ACHIEVEMENT_EVENT_READING_SESSION_SAVED, {
        userId: 1,
        bookFileId: 5,
        durationSeconds: 300,
        startedAt: new Date(),
        endedAt: new Date(),
        progressDelta: 10,
        endProgress: 50,
        timezone: 'UTC',
      });
      await new Promise((r) => setTimeout(r, 10));
      expect(mockSyncService.syncBook).toHaveBeenCalledWith(1, 42);
    });

    it('skips when autoSyncOnProgressUpdate disabled', async () => {
      mockSettingsService.getSettings.mockResolvedValue({ ...enabledSettings, autoSyncOnProgressUpdate: false });
      const { events } = makeListener();
      events.emit(ACHIEVEMENT_EVENT_READING_SESSION_SAVED, {
        userId: 1,
        bookFileId: 5,
        durationSeconds: 300,
        startedAt: new Date(),
        endedAt: new Date(),
        progressDelta: 10,
        endProgress: 50,
        timezone: 'UTC',
      });
      await new Promise((r) => setTimeout(r, 10));
      expect(mockSyncService.syncBook).not.toHaveBeenCalled();
    });
  });

  describe('rating changed event', () => {
    it('syncs each book when rating changes', async () => {
      mockSettingsService.getSettings.mockResolvedValue(enabledSettings);
      const { events } = makeListener();
      events.emit(ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED, { userId: 1, bookIds: [1, 2, 3], rating: 4 });
      await new Promise((r) => setTimeout(r, 10));
      expect(mockSyncService.syncBook).toHaveBeenCalledTimes(3);
    });

    it('skips when autoSyncOnRatingChange disabled', async () => {
      mockSettingsService.getSettings.mockResolvedValue({ ...enabledSettings, autoSyncOnRatingChange: false });
      const { events } = makeListener();
      events.emit(ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED, { userId: 1, bookIds: [1], rating: 4 });
      await new Promise((r) => setTimeout(r, 10));
      expect(mockSyncService.syncBook).not.toHaveBeenCalled();
    });
  });
});
