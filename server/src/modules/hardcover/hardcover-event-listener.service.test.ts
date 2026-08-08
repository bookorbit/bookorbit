import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ACHIEVEMENT_EVENT_BOOK_HARDCOVER_EDITION_CHANGED,
  ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED,
  ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED,
  ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
  ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
  AchievementEventsService,
} from '../achievement/achievement-events.service';
import { HardcoverAutoSyncSchedulerService } from './hardcover-auto-sync-scheduler.service';
import { HardcoverEventListener } from './hardcover-event-listener.service';
import { HardcoverRepository } from './hardcover.repository';

const mockScheduler = {
  requestSync: vi.fn(),
  requestSyncForBookFile: vi.fn(),
};

const mockRepo = {
  updateEditionIfLinked: vi.fn(),
};

function makeListener() {
  const events = new AchievementEventsService();
  const listener = new HardcoverEventListener(
    events,
    mockScheduler as unknown as HardcoverAutoSyncSchedulerService,
    mockRepo as unknown as HardcoverRepository,
  );
  listener.onModuleInit();
  return { events };
}

describe('HardcoverEventListener', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.updateEditionIfLinked.mockResolvedValue(true);
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

  it('schedules rating auto-sync for each affected book', () => {
    const { events } = makeListener();

    events.emit(ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED, { userId: 1, bookIds: [1, 2, 3], rating: 4 });

    expect(mockScheduler.requestSync).toHaveBeenCalledTimes(3);
    expect(mockScheduler.requestSync).toHaveBeenNthCalledWith(1, { userId: 1, bookId: 1, reason: 'rating' });
    expect(mockScheduler.requestSync).toHaveBeenNthCalledWith(2, { userId: 1, bookId: 2, reason: 'rating' });
    expect(mockScheduler.requestSync).toHaveBeenNthCalledWith(3, { userId: 1, bookId: 3, reason: 'rating' });
  });

  it('propagates a hardcoverEditionId change to the user sync state', async () => {
    const { events } = makeListener();

    events.emit(ACHIEVEMENT_EVENT_BOOK_HARDCOVER_EDITION_CHANGED, { userId: 1, bookId: 10, hardcoverEditionId: '200' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockRepo.updateEditionIfLinked).toHaveBeenCalledWith(1, 10, 200);
  });

  it('ignores a non-numeric hardcoverEditionId', async () => {
    const { events } = makeListener();

    events.emit(ACHIEVEMENT_EVENT_BOOK_HARDCOVER_EDITION_CHANGED, { userId: 1, bookId: 10, hardcoverEditionId: 'not-a-number' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockRepo.updateEditionIfLinked).not.toHaveBeenCalled();
  });
});
