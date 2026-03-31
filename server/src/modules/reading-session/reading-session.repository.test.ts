import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readingSessions, userReadingDailyStats } from '../../db/schema';
import { ReadingSessionRepository } from './reading-session.repository';

function makeDbHarness(options?: { fileLibraryId?: number | null; insertedIds?: Array<{ id: number }> }) {
  const fileLibraryId = options?.fileLibraryId === undefined ? 11 : options.fileLibraryId;
  const insertedIds = options?.insertedIds ?? [{ id: 1 }];

  const limit = vi.fn().mockResolvedValue(fileLibraryId == null ? [] : [{ libraryId: fileLibraryId }]);
  const where = vi.fn().mockReturnValue({ limit });
  const innerJoin = vi.fn().mockReturnValue({ where });
  const from = vi.fn().mockReturnValue({ innerJoin });
  const select = vi.fn().mockReturnValue({ from });

  const sessionReturning = vi.fn().mockResolvedValue(insertedIds);
  const sessionConflict = vi.fn().mockReturnValue({ returning: sessionReturning });
  const sessionValues = vi.fn().mockReturnValue({ onConflictDoNothing: sessionConflict });

  const dailyConflictUpdate = vi.fn().mockResolvedValue(undefined);
  const dailyValues = vi.fn().mockReturnValue({ onConflictDoUpdate: dailyConflictUpdate });

  const tx = {
    insert: vi.fn((table: unknown) => {
      if (table === readingSessions) return { values: sessionValues };
      if (table === userReadingDailyStats) return { values: dailyValues };
      throw new Error('Unexpected table in insert');
    }),
  };

  const transaction = vi.fn(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx));

  const db = { select, transaction };
  const repo = new ReadingSessionRepository(db as never);

  return {
    repo,
    select,
    transaction,
    sessionValues,
    sessionConflict,
    sessionReturning,
    dailyValues,
    dailyConflictUpdate,
  };
}

describe('ReadingSessionRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips when duration is below the minimum threshold', async () => {
    const { repo, select, transaction } = makeDbHarness();

    const result = await repo.saveSession(1, 2, 'short', new Date('2026-04-15T10:00:00.000Z'), new Date('2026-04-15T10:00:09.000Z'), 9, null, null);

    expect(result).toEqual({ kind: 'skipped', reason: 'duration_below_minimum' });
    expect(select).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('skips when no book file row is found', async () => {
    const { repo, transaction } = makeDbHarness({ fileLibraryId: null });

    const result = await repo.saveSession(
      1,
      9999,
      'missing-file',
      new Date('2026-04-15T10:00:00.000Z'),
      new Date('2026-04-15T10:00:20.000Z'),
      20,
      null,
      null,
    );

    expect(result).toEqual({ kind: 'skipped', reason: 'book_file_not_found' });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('skips when session id already exists (idempotent duplicate)', async () => {
    const { repo, dailyValues } = makeDbHarness({ insertedIds: [] });

    const result = await repo.saveSession(
      5,
      8,
      'duplicate-id',
      new Date('2026-04-15T10:00:00.000Z'),
      new Date('2026-04-15T10:01:00.000Z'),
      60,
      3.2,
      12.5,
    );

    expect(result).toEqual({ kind: 'skipped', reason: 'duplicate_session_id' });
    expect(dailyValues).not.toHaveBeenCalled();
  });

  it('persists session and upserts daily stats when insert succeeds', async () => {
    const { repo, sessionValues, dailyValues, dailyConflictUpdate } = makeDbHarness({ fileLibraryId: 3, insertedIds: [{ id: 99 }] });

    const result = await repo.saveSession(
      2,
      4,
      'new-session',
      new Date('2026-04-15T10:00:00.000Z'),
      new Date('2026-04-15T10:01:00.000Z'),
      60,
      null,
      42.5,
    );

    expect(result).toEqual({ kind: 'saved' });
    expect(sessionValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 2,
        bookFileId: 4,
        sessionId: 'new-session',
        durationSeconds: 60,
        progressDelta: null,
        endProgress: 42.5,
      }),
    );
    expect(dailyValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 2,
        libraryId: 3,
        readingSeconds: 60,
        progressDelta: 0,
        sessionsCount: 1,
        updatedAt: expect.any(Date),
      }),
    );
    expect(dailyValues.mock.calls[0]?.[0]).toHaveProperty('day');
    expect(dailyConflictUpdate).toHaveBeenCalledOnce();
  });
});
