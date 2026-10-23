import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { ReadingAttemptService } from '../src/modules/user-book-status/reading-attempt.service';
import { ReadingAttemptRepository } from '../src/modules/user-book-status/reading-attempt.repository';
import { READING_ATTEMPT_CHANGED, ReadingAttemptEventsService } from '../src/modules/user-book-status/reading-attempt-events.service';
import { DashboardWidgetService } from '../src/modules/dashboard/dashboard-widget.service';
import { DashboardWidgetRepository } from '../src/modules/dashboard/dashboard-widget.repository';
import { LibraryService } from '../src/modules/library/library.service';
import type { RequestUser } from '../src/common/types/request-user';

import { UserBookStatusService } from '../src/modules/user-book-status/user-book-status.service';
import { UserBookStatusRepository } from '../src/modules/user-book-status/user-book-status.repository';
import { KoboStatusProjectionRepository } from '../src/modules/user-book-status/kobo-status-projection.repository';
import { AchievementEventsService } from '../src/modules/achievement/achievement-events.service';

import { UserStatisticsService } from '../src/modules/user-statistics/user-statistics.service';
import { UserStatisticsRepository } from '../src/modules/user-statistics/user-statistics.repository';

import { makeFakeRepo } from './helpers/reading-attempt-repository.fake';

describe('Reading attempt cache integration', () => {
  let module: TestingModule;
  let fake: ReturnType<typeof makeFakeRepo>;
  let service: ReadingAttemptService;
  let dashboard: DashboardWidgetService;
  let events: ReadingAttemptEventsService;
  let statistics: UserStatisticsService;
  let listener: ReturnType<typeof vi.fn>;
  let countCompletedBooks: Mock<DashboardWidgetRepository['countCompletedBooks']>;
  const user = { id: 1, settings: { timezone: 'UTC' }, contentFilters: EMPTY_CONTENT_FILTER_RULES } as RequestUser;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T12:00:00Z'));
    fake = makeFakeRepo();
    countCompletedBooks = vi.fn<DashboardWidgetRepository['countCompletedBooks']>(
      (userId: number, _libraries: number[], fromDay: string, untilDay: string) =>
        Promise.resolve(
          fake.rows.filter(
            (row) =>
              row.userId === userId &&
              row.deletedAt === null &&
              row.outcome === 'completed' &&
              row.endedOn !== null &&
              row.endedOn >= fromDay &&
              row.endedOn < untilDay,
          ).length,
        ),
    );
    module = await Test.createTestingModule({
      providers: [
        ReadingAttemptService,
        UserBookStatusService,
        {
          provide: UserBookStatusRepository,
          useValue: { findOne: vi.fn().mockResolvedValue(null), findUserTimeZone: vi.fn().mockResolvedValue('UTC') },
        },
        { provide: AchievementEventsService, useValue: { emit: vi.fn() } },
        { provide: KoboStatusProjectionRepository, useValue: { isEnabled: vi.fn().mockResolvedValue(false) } },
        ReadingAttemptEventsService,
        DashboardWidgetService,
        UserStatisticsService,
        {
          provide: UserStatisticsRepository,
          useValue: {
            resolveActivityLibraryIds: vi.fn().mockResolvedValue([1, 2]),
            getActivitySessionPage: vi.fn().mockResolvedValue([]),
            getActivityActiveDays: vi.fn().mockResolvedValue([]),
            getActivityAvailableYears: vi.fn().mockResolvedValue([2025, 2026]),
            getActivityCompletionTimeline: vi.fn((userId: number) =>
              Promise.resolve(
                [2025, 2026].map((year) => ({
                  year,
                  month: 1,
                  count: fake.rows.filter(
                    (row) => row.userId === userId && row.deletedAt === null && row.outcome === 'completed' && row.endedOn?.startsWith(String(year)),
                  ).length,
                })),
              ),
            ),
            getProgressFunnelInRange: vi.fn().mockResolvedValue({ started: 0, reached25: 0, reached50: 0, reached75: 0, completed: 0 }),
            getActivityPaceSummary: vi
              .fn()
              .mockResolvedValue({ overall: { eligibleSessions: 0, medianDurationSeconds: null, medianProgressDelta: null }, byMedia: [] }),
          },
        },
        { provide: ReadingAttemptRepository, useValue: fake.repo },
        { provide: DashboardWidgetRepository, useValue: { countCompletedBooks, getCurrentlyReadingBooks: vi.fn().mockResolvedValue({ books: [] }) } },
        { provide: LibraryService, useValue: { findAccessibleLibraryIds: vi.fn().mockResolvedValue([1, 2]) } },
      ],
    }).compile();
    await module.init();
    service = module.get(ReadingAttemptService);
    dashboard = module.get(DashboardWidgetService);
    statistics = module.get(UserStatisticsService);
    events = module.get(ReadingAttemptEventsService);
    listener = vi.fn();
    events.on(READING_ATTEMPT_CHANGED, listener);
  });

  afterEach(async () => {
    await module?.close();
    vi.useRealTimers();
  });

  async function expectCount(count: number, reader = user) {
    expect(await dashboard.getReadingGoal(reader)).toMatchObject({ completedBooks: count, year: 2026 });
  }

  it('updates the cached goal immediately when a completion moves across years', async () => {
    await expectCount(0);
    const attempt = await service.createHistorical(1, 10, { endedOn: '2025-12-15', outcome: 'completed' });
    await expectCount(0);
    await service.update(1, 10, attempt.id, { endedOn: '2026-01-15' });
    await expectCount(1);
    await service.update(1, 10, attempt.id, { endedOn: '2025-12-15' });
    await expectCount(0);
    expect(countCompletedBooks).toHaveBeenCalledTimes(4);
  });

  it('refreshes after date-only edits when the book stays read', async () => {
    await service.applyManualStatus(1, 10, 'read', undefined, '2026-01-15', '2026-10-06');
    await expectCount(1);
    await service.applyManualStatus(1, 10, 'read', undefined, '2025-12-15', '2026-10-06', { statusWasExplicit: false });
    await expectCount(0);
  });

  it('refreshes after clearing and restoring a completion date', async () => {
    const attempt = await service.createHistorical(1, 10, { endedOn: '2026-01-15', outcome: 'completed' });
    await expectCount(1);
    await service.update(1, 10, attempt.id, { endedOn: null });
    await expectCount(0);
    await service.update(1, 10, attempt.id, { endedOn: '2026-02-01' });
    await expectCount(1);
  });

  it('refreshes after changing an outcome and deleting a completion', async () => {
    const attempt = await service.createHistorical(1, 10, { endedOn: '2026-01-15', outcome: 'completed' });
    await expectCount(1);
    await service.update(1, 10, attempt.id, { outcome: 'skimmed' });
    await expectCount(0);
    await service.update(1, 10, attempt.id, { outcome: 'completed' });
    await expectCount(1);
    await service.delete(1, 10, attempt.id);
    await expectCount(0);
  });

  it.each(['bookorbit', 'kobo', 'koreader'] as const)('refreshes after an automatic %s completion', async (origin) => {
    await service.applyManualStatus(1, 10, 'reading', undefined, undefined, '2026-10-06');
    await expectCount(0);
    await service.recordActivity({
      userId: 1,
      bookId: 10,
      occurredOn: '2026-10-06',
      origin,
      progress: 100,
      finishThreshold: 98,
      strongRereadEvidence: false,
      meaningfulActivity: true,
    });
    await expectCount(1);
  });

  it('refreshes after importing an external completion or filling its missing date', async () => {
    await expectCount(0);
    await service.importExternalRead(1, 10, { provider: 'hardcover', externalId: 'dated', startedOn: null, endedOn: '2026-01-15' });
    await expectCount(1);
    await service.importExternalRead(1, 20, { provider: 'hardcover', externalId: 'undated', startedOn: null, endedOn: null });
    await expectCount(1);
    await service.importExternalRead(1, 20, { provider: 'hardcover', externalId: 'undated', startedOn: null, endedOn: '2026-02-01' });
    await expectCount(2);
  });

  it('invalidates every library scope for the changed reader without evicting other readers', async () => {
    const selected = { ...user, settings: { dashboardConfig: { libraryIds: [1] } } } as RequestUser;
    const other = { ...user, id: 11 };
    await expectCount(0);
    await expectCount(0, selected);
    await expectCount(0, other);
    await dashboard.getCurrentlyReading(user);
    await service.createHistorical(1, 10, { endedOn: '2026-01-15', outcome: 'completed' });
    await expectCount(1);
    await expectCount(1, selected);
    await expectCount(0, other);
    await dashboard.getCurrentlyReading(user);
    expect(countCompletedBooks).toHaveBeenCalledTimes(5);
    expect(module.get(DashboardWidgetRepository).getCurrentlyReadingBooks).toHaveBeenCalledTimes(2);
  });

  it('does not repopulate the cache from a query started before the mutation committed', async () => {
    let resolveOld!: (count: number) => void;
    countCompletedBooks.mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          resolveOld = resolve;
        }),
    );
    const pending = dashboard.getReadingGoal(user);
    await vi.waitFor(() => expect(countCompletedBooks).toHaveBeenCalledOnce());
    await service.createHistorical(1, 10, { endedOn: '2026-01-15', outcome: 'completed' });
    await expectCount(1);
    resolveOld(0);
    expect((await pending).completedBooks).toBe(0);
    await expectCount(1);
    expect(countCompletedBooks).toHaveBeenCalledTimes(2);
  });

  it('emits only after the transaction commits', async () => {
    const commit = vi.fn();
    fake.repo.transaction.mockImplementation(async (callback) => {
      const result = await callback(fake.transactionContext);
      expect(listener).not.toHaveBeenCalled();
      commit();
      return result;
    });
    await service.applyManualStatus(1, 10, 'read', undefined, '2026-01-15', '2026-10-06');
    expect(listener).toHaveBeenCalledExactlyOnceWith({ userId: 1 });
    expect(commit.mock.invocationCallOrder[0]).toBeLessThan(listener.mock.invocationCallOrder[0]);
  });

  it('keeps cached results on rejected mutations', async () => {
    await expectCount(0);
    await expect(service.createHistorical(1, 10, { startedOn: '2026-02-01', endedOn: '2026-01-15', outcome: 'completed' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.update(1, 10, 999, { endedOn: '2026-01-15' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.delete(1, 10, 999)).rejects.toBeInstanceOf(NotFoundException);
    fake.repo.transaction.mockRejectedValueOnce(new Error('Transaction rolled back'));
    await expect(service.applyManualStatus(1, 10, 'read', undefined, '2026-01-15', '2026-10-06')).rejects.toThrow('Transaction rolled back');
    await expectCount(0);
    expect(listener).not.toHaveBeenCalled();
    expect(countCompletedBooks).toHaveBeenCalledOnce();
  });

  it('invalidates committed history even when rebuilding its status projection fails', async () => {
    await expectCount(0);
    fake.repo.project.mockRejectedValueOnce(new Error('Projection failed'));
    await expect(service.createHistorical(1, 10, { endedOn: '2026-01-15', outcome: 'completed' })).rejects.toThrow('Projection failed');
    await expectCount(1);
  });

  it.each(['bookorbit', 'kobo', 'koreader'] as const)('refreshes currently-reading immediately on a projection-only %s resume', async (origin) => {
    await service.applyManualStatus(1, 10, 'on_hold', undefined, undefined, '2026-10-06');
    const getBooks = module.get(DashboardWidgetRepository).getCurrentlyReadingBooks;
    vi.mocked(getBooks).mockImplementation(async () => {
      const status = await fake.repo.findStatus(fake.transactionContext, 1, 10);
      return {
        books:
          status?.status === 'reading'
            ? [
                {
                  bookId: 10,
                  title: 'Book',
                  authors: [],
                  progress: 25,
                  hasCover: false,
                  fileId: null,
                  fileFormat: null,
                  readFileId: null,
                  readFileFormat: null,
                  readAlongFileId: null,
                  hasAudio: false,
                },
              ]
            : [],
      };
    });
    expect((await dashboard.getCurrentlyReading(user)).books).toEqual([]);
    await expectCount(0);
    listener.mockClear();
    fake.repo.create.mockClear();
    fake.repo.update.mockClear();
    await service.recordActivity({
      userId: 1,
      bookId: 10,
      occurredOn: '2026-10-06',
      origin,
      progress: 25,
      finishThreshold: 98,
      strongRereadEvidence: false,
      meaningfulActivity: true,
    });
    expect(fake.repo.create).not.toHaveBeenCalled();
    expect(fake.repo.update).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledExactlyOnceWith({ userId: 1 });
    expect((await dashboard.getCurrentlyReading(user)).books).toEqual([expect.objectContaining({ bookId: 10 })]);
    await expectCount(0);
    expect(getBooks).toHaveBeenCalledTimes(2);
  });

  it('does not notify a projection-only resume when its transaction rolls back', async () => {
    await service.applyManualStatus(1, 10, 'on_hold', undefined, undefined, '2026-10-06');
    await dashboard.getCurrentlyReading(user);
    listener.mockClear();
    fake.repo.project.mockRejectedValueOnce(new Error('Projection failed'));
    await expect(
      service.recordActivity({
        userId: 1,
        bookId: 10,
        occurredOn: '2026-10-06',
        origin: 'kobo',
        progress: 25,
        finishThreshold: 98,
        strongRereadEvidence: false,
        meaningfulActivity: true,
      }),
    ).rejects.toThrow('Projection failed');
    expect(listener).not.toHaveBeenCalled();
    await dashboard.getCurrentlyReading(user);
    expect(module.get(DashboardWidgetRepository).getCurrentlyReadingBooks).toHaveBeenCalledOnce();
  });

  it('flushes cache notifications with explicit owner ids on both cache hits and misses', async () => {
    const flush = vi.spyOn(events, 'flushPendingChanges');
    await expectCount(0);
    await expectCount(0);
    await dashboard.getCurrentlyReading(user);
    await dashboard.getCurrentlyReading(user);
    await statistics.getActivityOverview({ ...user, id: 11 }, {});
    await statistics.getActivityOverview({ ...user, id: 11 }, {});
    expect(flush.mock.calls.slice(0, 4)).toEqual([[1], [1], [1], [1]]);
    expect(flush.mock.calls.slice(4).every(([id]) => id === 11)).toBe(true);
    expect(flush).toHaveBeenCalledWith(11);
  });

  it('preserves the cache on automatic activity that changes neither attempts nor projection', async () => {
    await service.applyManualStatus(1, 10, 'reading', undefined, undefined, '2026-10-06');
    const activity = {
      userId: 1,
      bookId: 10,
      occurredOn: '2026-10-06',
      origin: 'bookorbit' as const,
      progress: 25,
      finishThreshold: 98,
      strongRereadEvidence: false,
      meaningfulActivity: true,
    };
    await service.recordActivity(activity);
    await expectCount(0);
    listener.mockClear();
    await service.recordActivity(activity);
    await expectCount(0);
    expect(listener).not.toHaveBeenCalled();
    expect(countCompletedBooks).toHaveBeenCalledOnce();
  });

  it('preserves the cache when an external import makes no changes or would resurrect a deletion', async () => {
    const input = { provider: 'hardcover' as const, externalId: 'external-read', startedOn: null, endedOn: '2026-01-15' };
    await service.importExternalRead(1, 10, input);
    await expectCount(1);
    listener.mockClear();
    await service.importExternalRead(1, 10, input);
    await expectCount(1);
    expect(listener).not.toHaveBeenCalled();
    expect(fake.repo.update).not.toHaveBeenCalled();
    await service.delete(1, 10, fake.rows[0].id);
    await expectCount(0);
    listener.mockClear();
    await service.importExternalRead(1, 10, input);
    await expectCount(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it('refreshes statistics completion totals and goal charts immediately across years and users', async () => {
    const other = { ...user, id: 11 };
    const overview = (reader = user) => statistics.getActivityOverview(reader, { libraryIds: [1] });
    expect((await overview()).goal.completedBooks).toBe(0);
    expect((await overview(other)).goal.completedBooks).toBe(0);
    await service.createHistorical(1, 10, { endedOn: '2026-01-15', outcome: 'completed' });
    const current = await overview();
    expect(current.goal.completedBooks).toBe(1);
    expect(current.goal.points[0].actualCumulative).toBe(1);
    await service.update(1, 10, fake.rows[0].id, { endedOn: '2025-12-15' });
    expect((await overview()).goal.completedBooks).toBe(0);
    expect((await overview(other)).goal.completedBooks).toBe(0);
    const repo = module.get(UserStatisticsRepository);
    expect(repo.getActivityCompletionTimeline).toHaveBeenCalledTimes(4);
  });

  it('makes a committed batch mutation visible to dashboard and statistics reads before the batch finishes', async () => {
    await expectCount(0);
    expect((await statistics.getActivityOverview(user, {})).goal.completedBooks).toBe(0);
    await service.coalesceChanges(async () => {
      await service.createHistorical(1, 10, { endedOn: '2026-01-15', outcome: 'completed' });
      expect(listener).not.toHaveBeenCalled();
      await expectCount(1);
      expect((await statistics.getActivityOverview(user, {})).goal.completedBooks).toBe(1);
      await service.update(1, 10, fake.rows[0].id, { endedOn: '2025-12-15' });
      expect((await statistics.getActivityOverview(user, {})).goal.completedBooks).toBe(0);
      await expectCount(0);
    });
  });

  it('preserves caches for no-op manual and historical updates while retaining timestamp writes', async () => {
    await service.applyManualStatus(1, 10, 'read', undefined, '2026-01-15', '2026-10-06');
    await expectCount(1);
    listener.mockClear();
    await service.applyManualStatus(1, 10, 'read', undefined, undefined, '2026-10-06');
    await service.applyManualStatus(1, 10, 'read', undefined, '2026-01-15', '2026-10-06');
    await service.update(1, 10, fake.rows[0].id, {});
    await service.update(1, 10, fake.rows[0].id, { endedOn: '2026-01-15' });
    await expectCount(1);
    expect(listener).not.toHaveBeenCalled();
    expect(countCompletedBooks).toHaveBeenCalledOnce();
    expect(fake.repo.update).toHaveBeenCalled();
  });

  it('keeps invalidating both subscribers when another listener throws after a committed mutation', async () => {
    const { Logger } = await import('@nestjs/common');
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    events.prependListener(READING_ATTEMPT_CHANGED, () => {
      throw new Error('Listener failed');
    });
    await expectCount(0);
    expect((await statistics.getActivityOverview(user, {})).goal.completedBooks).toBe(0);
    await expect(service.createHistorical(1, 10, { endedOn: '2026-01-15', outcome: 'completed' })).resolves.toMatchObject({ endedOn: '2026-01-15' });
    await expectCount(1);
    expect((await statistics.getActivityOverview(user, {})).goal.completedBooks).toBe(1);
    fake.repo.project.mockRejectedValueOnce(new Error('Projection failed'));
    await expect(service.update(1, 10, fake.rows[0].id, { endedOn: '2025-12-15' })).rejects.toThrow('Projection failed');
    await expectCount(0);
    expect((await statistics.getActivityOverview(user, {})).goal.completedBooks).toBe(0);
    warn.mockRestore();
  });

  it('refreshes every reader after shared book or library history is deleted', async () => {
    const other = { ...user, id: 11 };
    await service.createHistorical(1, 10, { endedOn: '2026-01-15', outcome: 'completed' });
    await service.createHistorical(11, 10, { endedOn: '2026-01-15', outcome: 'completed' });
    await expectCount(1);
    await expectCount(1, other);
    expect((await statistics.getActivityOverview(user, {})).goal.completedBooks).toBe(1);
    expect((await statistics.getActivityOverview(other, {})).goal.completedBooks).toBe(1);
    fake.rows.splice(0);
    events.notifyChanged(null);
    await expectCount(0);
    await expectCount(0, other);
    expect((await statistics.getActivityOverview(user, {})).goal.completedBooks).toBe(0);
    expect((await statistics.getActivityOverview(other, {})).goal.completedBooks).toBe(0);
  });

  it('coalesces large bulk status changes across the whole operation and skips unchanged reruns', async () => {
    const statuses = module.get(UserBookStatusService);
    await expectCount(0);
    await statuses.bulkSetManual(
      1,
      Array.from({ length: 123 }, (_, index) => index + 1),
      'read',
    );
    expect(listener).toHaveBeenCalledExactlyOnceWith({ userId: 1 });
    await expectCount(123);
    expect((await statistics.getActivityOverview(user, {})).goal.completedBooks).toBe(123);
    listener.mockClear();
    await statuses.bulkSetManual(
      1,
      Array.from({ length: 123 }, (_, index) => index + 1),
      'read',
    );
    expect(listener).not.toHaveBeenCalled();
    await expectCount(123);
    expect(countCompletedBooks).toHaveBeenCalledTimes(2);
  });

  it('serves fresh reads between bounded write batches and flushes later commits at operation end', async () => {
    const statuses = module.get(UserBookStatusService);
    await expectCount(0);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const create = fake.repo.create.getMockImplementation()!;
    fake.repo.create.mockImplementation(async (tx, values) => {
      if (values.bookId === 51) {
        entered();
        await gate;
      }
      return create(tx, values);
    });
    const operation = statuses.bulkSetManual(
      1,
      Array.from({ length: 51 }, (_, index) => index + 1),
      'read',
    );
    await started;
    expect(listener).not.toHaveBeenCalled();
    await expectCount(50);
    expect((await statistics.getActivityOverview(user, {})).goal.completedBooks).toBe(50);
    expect(listener).toHaveBeenCalledExactlyOnceWith({ userId: 1 });
    release();
    await operation;
    expect(listener).toHaveBeenCalledTimes(2);
    await expectCount(51);
    expect((await statistics.getActivityOverview(user, {})).goal.completedBooks).toBe(51);
  });

  it('flushes earlier committed batches when a later write batch fails', async () => {
    const statuses = module.get(UserBookStatusService);
    await expectCount(0);
    const create = fake.repo.create.getMockImplementation()!;
    fake.repo.create.mockImplementation((tx, values) => {
      if (values.bookId === 51) return Promise.reject(new Error('Later batch failed'));
      return create(tx, values);
    });
    await expect(
      statuses.bulkSetManual(
        1,
        Array.from({ length: 51 }, (_, index) => index + 1),
        'read',
      ),
    ).rejects.toThrow('Later batch failed');
    expect(listener).toHaveBeenCalledExactlyOnceWith({ userId: 1 });
    await expectCount(50);
    expect((await statistics.getActivityOverview(user, {})).goal.completedBooks).toBe(50);
  });

  it('waits for successful siblings before flushing a failed bulk batch', async () => {
    const statuses = module.get(UserBookStatusService);
    await expectCount(0);
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const create = fake.repo.create.getMockImplementation()!;
    fake.repo.create.mockImplementation(async (tx, values) => {
      if (values.bookId === 1) throw new Error('Write failed');
      started();
      await gate;
      return create(tx, values);
    });
    const outcome = statuses.bulkSetManual(1, [1, 2], 'read').catch((error: unknown) => error);
    await entered;
    expect(listener).not.toHaveBeenCalled();
    release();
    expect(await outcome).toMatchObject({ message: 'Write failed' });
    expect(listener).toHaveBeenCalledExactlyOnceWith({ userId: 1 });
    await expectCount(1);
    expect((await statistics.getActivityOverview(user, {})).goal.completedBooks).toBe(1);
  });

  it('removes the statistics subscription without removing other subscribers', () => {
    statistics.onModuleDestroy();
    const invalidate = vi.spyOn(statistics, 'invalidateUser');
    const dashboardClear = vi.spyOn(dashboard, 'clearCacheForUser');
    events.notifyChanged(1);
    expect(invalidate).not.toHaveBeenCalled();
    expect(dashboardClear).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('removes its listener when the dashboard module shuts down', () => {
    const unrelated = vi.fn();
    events.on(READING_ATTEMPT_CHANGED, unrelated);
    dashboard.onModuleDestroy();
    const clear = vi.spyOn(dashboard, 'clearCacheForUser');
    events.notifyChanged(1);
    expect(clear).not.toHaveBeenCalled();
    expect(unrelated).toHaveBeenCalledExactlyOnceWith({ userId: 1 });
  });
});
