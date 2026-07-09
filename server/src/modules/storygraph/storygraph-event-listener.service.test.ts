import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED,
  ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
  ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
  AchievementEventsService,
} from '../achievement/achievement-events.service';
import { StorygraphAutoSyncSchedulerService } from './storygraph-auto-sync-scheduler.service';
import { StorygraphEventListener } from './storygraph-event-listener.service';

const mockScheduler = {
  requestSync: vi.fn(),
  requestSyncForBookFile: vi.fn(),
};

function makeListener() {
  const events = new AchievementEventsService();
  const listener = new StorygraphEventListener(events, mockScheduler as unknown as StorygraphAutoSyncSchedulerService);
  listener.onModuleInit();
  return { events };
}

describe('StorygraphEventListener', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('schedules status auto-sync on status change', () => {
    const { events } = makeListener();

    events.emit(ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, { userId: 1, bookId: 10, newStatus: 'reading', previousStatus: 'unread' });

    expect(mockScheduler.requestSync).toHaveBeenCalledWith({ userId: 1, bookId: 10, reason: 'status' });
  });

  it('schedules file progress auto-sync for reading sessions', () => {
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

    expect(mockScheduler.requestSyncForBookFile).toHaveBeenCalledWith({ userId: 1, bookFileId: 5, reason: 'progress' });
  });

  it('schedules progress auto-sync on book progress changes', () => {
    const { events } = makeListener();

    events.emit(ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED, {
      userId: 1,
      bookId: 10,
      bookFileId: 5,
      progress: 40,
      source: 'koreader',
    });

    expect(mockScheduler.requestSync).toHaveBeenCalledWith({ userId: 1, bookId: 10, reason: 'progress' });
  });
});
