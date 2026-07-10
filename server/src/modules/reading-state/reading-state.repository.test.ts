import { NotFoundException } from '@nestjs/common';

import {
  audiobookProgress,
  koreaderDeviceProgress,
  koreaderPageStats,
  koboReadingStates,
  readingProgress,
  readingSessions,
  userBookStatus,
  userReadingDailyStats,
} from '../../db/schema';
import { ReadingStateRepository } from './reading-state.repository';

function makeSelectChain(result: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> & { then?: PromiseLike<unknown>['then']; getSQL?: ReturnType<typeof vi.fn> } = {};
  for (const method of ['from', 'where', 'orderBy', 'innerJoin', 'leftJoin']) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.limit = vi.fn().mockResolvedValue(result);
  chain.getSQL = vi.fn();
  chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

function makeHarness(selectResults: unknown[]) {
  const selectChains: ReturnType<typeof makeSelectChain>[] = [];
  const select = vi.fn(() => {
    const chain = makeSelectChain(selectResults.shift() ?? []);
    selectChains.push(chain);
    return chain;
  });

  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const deleteFn = vi.fn(() => ({ where: deleteWhere }));

  const statusConflict = vi.fn().mockResolvedValue(undefined);
  const statusValues = vi.fn(() => ({ onConflictDoUpdate: statusConflict }));
  const dailyConflict = vi.fn().mockResolvedValue(undefined);
  const dailyValues = vi.fn(() => ({ onConflictDoUpdate: dailyConflict }));
  const insert = vi.fn((table: unknown) => {
    if (table === userBookStatus) return { values: statusValues };
    if (table === userReadingDailyStats) return { values: dailyValues };
    throw new Error('Unexpected table in insert');
  });

  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  const execute = vi.fn().mockResolvedValue(undefined);
  const tx = { select, delete: deleteFn, insert, update, execute };
  const transaction = vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx));
  const db = { transaction };

  return {
    repo: new ReadingStateRepository(db as never),
    transaction,
    tx,
    selectChains,
    deleteFn,
    statusValues,
    statusConflict,
    dailyValues,
    dailyConflict,
    update,
    updateSet,
  };
}

describe('ReadingStateRepository', () => {
  it('atomically clears every persisted reading source, resets Kobo, and rebuilds affected daily totals', async () => {
    const deletedSession = {
      id: 11,
      startedAt: new Date('2026-04-15T10:00:00.000Z'),
      endedAt: new Date('2026-04-15T10:20:00.000Z'),
      durationSeconds: 1200,
      progressDelta: 4,
    };
    const remainingSession = {
      id: 99,
      startedAt: new Date('2026-04-15T12:00:00.000Z'),
      endedAt: new Date('2026-04-15T12:30:00.000Z'),
      durationSeconds: 1800,
      progressDelta: 6,
    };
    const { repo, transaction, tx, deleteFn, statusValues, statusConflict, dailyValues, dailyConflict, update, updateSet } = makeHarness([
      [{ libraryId: 3 }],
      [deletedSession],
      [],
      [{ total: 2 }],
      [{ total: 1 }],
      [{ total: 3 }],
      [{ total: 4 }],
      [{ id: 88 }],
      [remainingSession],
    ]);

    const result = await repo.resetBookReadingState(7, 42, 'UTC');

    expect(transaction).toHaveBeenCalledOnce();
    expect(deleteFn).toHaveBeenCalledWith(readingProgress);
    expect(deleteFn).toHaveBeenCalledWith(audiobookProgress);
    expect(deleteFn).toHaveBeenCalledWith(koreaderDeviceProgress);
    expect(deleteFn).toHaveBeenCalledWith(koreaderPageStats);
    expect(deleteFn).toHaveBeenCalledWith(readingSessions);
    expect(deleteFn).toHaveBeenCalledWith(userReadingDailyStats);
    expect(statusValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        bookId: 42,
        status: 'unread',
        source: 'manual',
        startedAt: null,
        finishedAt: null,
      }),
    );
    expect(statusConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        target: [userBookStatus.userId, userBookStatus.bookId],
        set: expect.objectContaining({ status: 'unread', source: 'manual', startedAt: null, finishedAt: null }),
      }),
    );
    expect(update).toHaveBeenCalledWith(koboReadingStates);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        currentBookmark: expect.objectContaining({ ProgressPercent: 0 }),
        statusInfo: expect.objectContaining({ Status: 'ReadyToRead', TimesStartedReading: 0 }),
      }),
    );
    expect(tx.execute).toHaveBeenCalledTimes(2);
    expect(dailyValues).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: 7,
        libraryId: 3,
        day: '2026-04-15',
        readingSeconds: 1800,
        progressDelta: 6,
        sessionsCount: 1,
      }),
    ]);
    expect(dailyConflict).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      readStatus: { status: 'unread', source: 'manual', startedAt: null, finishedAt: null },
      sessionsDeleted: 1,
      progressDeleted: 2,
      audioProgressDeleted: 1,
      koreaderDeviceProgressDeleted: 3,
      koreaderPageStatsDeleted: 4,
      koboStateReset: true,
    });
  });

  it('fails before destructive work when the book no longer exists', async () => {
    const { repo, transaction, tx } = makeHarness([[]]);

    await expect(repo.resetBookReadingState(7, 404, 'UTC')).rejects.toThrow(NotFoundException);

    expect(transaction).toHaveBeenCalledOnce();
    expect(tx.execute).not.toHaveBeenCalled();
    expect(tx.delete).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
  });
});
