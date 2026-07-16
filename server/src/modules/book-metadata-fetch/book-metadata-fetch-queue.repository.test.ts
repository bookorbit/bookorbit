vi.mock('drizzle-orm', () => {
  const sqlFn = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ op: 'sql', text: strings.join(''), values }));
  (sqlFn as typeof sqlFn & { join: ReturnType<typeof vi.fn> }).join = vi.fn((chunks: unknown[], separator: unknown) => ({
    op: 'sql.join',
    chunks,
    separator,
  }));

  return {
    and: vi.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
    asc: vi.fn((value: unknown) => ({ op: 'asc', value })),
    count: vi.fn(() => ({ op: 'count' })),
    eq: vi.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
    inArray: vi.fn((left: unknown, values: unknown[]) => ({ op: 'inArray', left, values })),
    isNull: vi.fn((value: unknown) => ({ op: 'isNull', value })),
    or: vi.fn((...clauses: unknown[]) => ({ op: 'or', clauses })),
    sql: sqlFn,
  };
});

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { BookMetadataFetchConfig } from '@bookorbit/types';

import { bookMetadata, bookMetadataFetchQueue, bookNarrators, books } from '../../db/schema';
import { BookMetadataFetchQueueRepository } from './book-metadata-fetch-queue.repository';

describe('BookMetadataFetchQueueRepository', () => {
  const makeDb = () => {
    const insertBuilder = {
      values: vi.fn(),
      onConflictDoUpdate: vi.fn(),
      returning: vi.fn(),
    };
    insertBuilder.values.mockReturnValue(insertBuilder);
    insertBuilder.onConflictDoUpdate.mockReturnValue(insertBuilder);
    insertBuilder.returning.mockResolvedValue([]);

    const selectBuilder = {
      from: vi.fn(),
      where: vi.fn(),
      innerJoin: vi.fn(),
      leftJoin: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
      groupBy: vi.fn(),
      offset: vi.fn(),
    };
    selectBuilder.from.mockReturnValue(selectBuilder);
    selectBuilder.where.mockReturnValue(selectBuilder);
    selectBuilder.innerJoin.mockReturnValue(selectBuilder);
    selectBuilder.leftJoin.mockReturnValue(selectBuilder);
    selectBuilder.orderBy.mockReturnValue(selectBuilder);
    selectBuilder.offset.mockReturnValue(selectBuilder);
    selectBuilder.limit.mockResolvedValue([]);
    selectBuilder.groupBy.mockResolvedValue([]);

    const updateBuilder = {
      set: vi.fn(),
      where: vi.fn(),
      returning: vi.fn(),
    };
    updateBuilder.set.mockReturnValue(updateBuilder);
    updateBuilder.where.mockReturnValue(updateBuilder);
    updateBuilder.returning.mockResolvedValue([]);

    const deleteBuilder = {
      where: vi.fn(),
      returning: vi.fn(),
    };
    deleteBuilder.where.mockReturnValue(deleteBuilder);
    deleteBuilder.returning.mockResolvedValue([]);

    return {
      db: {
        insert: vi.fn().mockReturnValue(insertBuilder),
        select: vi.fn().mockReturnValue(selectBuilder),
        update: vi.fn().mockReturnValue(updateBuilder),
        delete: vi.fn().mockReturnValue(deleteBuilder),
      },
      insertBuilder,
      selectBuilder,
      updateBuilder,
      deleteBuilder,
    };
  };

  const baseConfig = (): BookMetadataFetchConfig => ({
    enabled: true,
    triggerOnImport: false,
    conditions: {
      neverFetched: { enabled: false },
      scoreThreshold: { enabled: false, threshold: 60 },
      missingFields: { enabled: false, fields: [] },
    },
  });

  it('upsertSchedule dedupes ids and only re-queues failed rows on conflict', async () => {
    const { db, insertBuilder } = makeDb();
    insertBuilder.returning.mockResolvedValueOnce([{ bookId: 1 }, { bookId: 2 }]);
    const repo = new BookMetadataFetchQueueRepository(db as never);

    const queued = await repo.upsertSchedule([1, 1, 2, -1, 0], 'manual_trigger');

    expect(queued).toBe(2);
    expect(insertBuilder.values).toHaveBeenCalledWith([
      expect.objectContaining({ bookId: 1, status: 'queued', reason: 'manual_trigger', attemptCount: 0 }),
      expect.objectContaining({ bookId: 2, status: 'queued', reason: 'manual_trigger', attemptCount: 0 }),
    ]);
    expect(eq).toHaveBeenCalledWith(bookMetadataFetchQueue.status, 'failed');
    expect(insertBuilder.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: bookMetadataFetchQueue.bookId,
        setWhere: expect.objectContaining({ op: 'eq', right: 'failed' }),
      }),
    );
  });

  it('fetchEligibleBookIds supports narrators, duration, and abridged missing-field filters', async () => {
    const { db, selectBuilder } = makeDb();
    selectBuilder.where.mockResolvedValueOnce([{ bookId: 7 }, { bookId: 8 }]);
    const repo = new BookMetadataFetchQueueRepository(db as never);
    const config = baseConfig();
    config.conditions.missingFields.enabled = true;
    config.conditions.missingFields.fields = ['narrators', 'duration', 'abridged'];

    const ids = await repo.fetchEligibleBookIds(config, 5);

    expect(ids).toEqual([7, 8]);
    expect(eq).toHaveBeenCalledWith(books.libraryId, 5);

    const sqlCalls = vi.mocked(sql).mock.calls;
    const hasNarratorsClause = sqlCalls.some((call) => call.slice(1).includes(bookNarrators));
    const hasDurationClause = sqlCalls.some((call) => call.slice(1).includes(bookMetadata.durationSeconds));
    const hasAbridgedClause = sqlCalls.some((call) => call.slice(1).includes(bookMetadata.abridged));

    expect(hasNarratorsClause).toBe(true);
    expect(hasDurationClause).toBe(true);
    expect(hasAbridgedClause).toBe(true);
  });

  it('returns empty results without touching the database when no conditions are enabled', async () => {
    const { db } = makeDb();
    const repo = new BookMetadataFetchQueueRepository(db as never);

    await expect(repo.fetchEligibleBookIds(baseConfig())).resolves.toEqual([]);
    await expect(repo.countEligibleBooks(baseConfig())).resolves.toBe(0);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('countEligibleBooks returns SQL count for valid predicates', async () => {
    const { db, selectBuilder } = makeDb();
    selectBuilder.where.mockResolvedValueOnce([{ cnt: 3 }]);
    const repo = new BookMetadataFetchQueueRepository(db as never);
    const config = baseConfig();
    config.conditions.neverFetched.enabled = true;

    await expect(repo.countEligibleBooks(config)).resolves.toBe(3);
    expect(and).toHaveBeenCalled();
  });

  it('markProcessing returns true when queue row is claimed', async () => {
    const { db, updateBuilder } = makeDb();
    updateBuilder.returning.mockResolvedValueOnce([{ bookId: 44 }]);
    const repo = new BookMetadataFetchQueueRepository(db as never);

    await expect(repo.markProcessing(44)).resolves.toBe(true);
  });

  it('markProcessing returns false on unique-violation races and throws unknown errors', async () => {
    const { db, updateBuilder } = makeDb();
    const repo = new BookMetadataFetchQueueRepository(db as never);

    updateBuilder.returning.mockRejectedValueOnce({ code: '23505' });
    await expect(repo.markProcessing(44)).resolves.toBe(false);

    updateBuilder.returning.mockRejectedValueOnce(new Error('db down'));
    await expect(repo.markProcessing(44)).rejects.toThrow('db down');
  });

  it('markFailed truncates long error text and normalizes http status', async () => {
    const { db, updateBuilder } = makeDb();
    const repo = new BookMetadataFetchQueueRepository(db as never);

    await repo.markFailed(10, 'x'.repeat(3000));

    expect(updateBuilder.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        lastError: 'x'.repeat(2000),
        lastHttpStatus: null,
      }),
    );
  });

  it('cancelPending and requeueFailed return row counts from write results', async () => {
    const { db, deleteBuilder, updateBuilder } = makeDb();
    deleteBuilder.returning.mockResolvedValueOnce([{ bookId: 1 }, { bookId: 2 }]);
    updateBuilder.returning.mockResolvedValueOnce([{ bookId: 9 }]);
    const repo = new BookMetadataFetchQueueRepository(db as never);

    await expect(repo.cancelPending()).resolves.toBe(2);
    await expect(repo.requeueFailed()).resolves.toBe(1);
  });

  it('getStatusSummary maps grouped counts by queue status', async () => {
    const { db, selectBuilder } = makeDb();
    selectBuilder.groupBy.mockResolvedValue([
      { status: 'queued', cnt: '5' },
      { status: 'processing', cnt: '2' },
      { status: 'failed', cnt: '1' },
    ]);
    const repo = new BookMetadataFetchQueueRepository(db as never);

    await expect(repo.getStatusSummary()).resolves.toEqual({
      queued: 5,
      processing: 2,
      failed: 1,
    });
  });

  it('resetAllProcessingOnBoot and recoverStuckProcessing return recovered row counts', async () => {
    const { db, updateBuilder } = makeDb();
    updateBuilder.returning.mockResolvedValueOnce([{ bookId: 1 }, { bookId: 2 }]).mockResolvedValueOnce([{ bookId: 4 }]);
    const repo = new BookMetadataFetchQueueRepository(db as never);

    await expect(repo.resetAllProcessingOnBoot()).resolves.toBe(2);
    await expect(repo.recoverStuckProcessing()).resolves.toBe(1);
  });

  it('scheduleEligibleBooksInBatches walks cursor pages and accumulates queued totals', async () => {
    const { db, selectBuilder } = makeDb();
    selectBuilder.limit.mockResolvedValueOnce([{ bookId: 2 }, { bookId: 5 }]).mockResolvedValueOnce([]);
    const repo = new BookMetadataFetchQueueRepository(db as never);
    vi.spyOn(repo, 'upsertSchedule').mockResolvedValueOnce(2);
    const config = baseConfig();
    config.conditions.neverFetched.enabled = true;

    await expect(repo.scheduleEligibleBooksInBatches(config, 'manual_trigger', undefined, 2)).resolves.toBe(2);
    expect(repo.upsertSchedule).toHaveBeenCalledWith([2, 5], 'manual_trigger');
  });

  it('fetchDue short-circuits for non-positive limits', async () => {
    const { db } = makeDb();
    const repo = new BookMetadataFetchQueueRepository(db as never);

    await expect(repo.fetchDue(0)).resolves.toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('markDone deletes queue rows by book id', async () => {
    const { db, deleteBuilder } = makeDb();
    const repo = new BookMetadataFetchQueueRepository(db as never);

    await expect(repo.markDone(9)).resolves.toBeUndefined();
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(deleteBuilder.where).toHaveBeenCalledTimes(1);
  });

  it('scheduleEligibleBooksInBatches returns 0 for non-positive batch sizes', async () => {
    const { db } = makeDb();
    const repo = new BookMetadataFetchQueueRepository(db as never);
    const config = baseConfig();
    config.conditions.neverFetched.enabled = true;

    await expect(repo.scheduleEligibleBooksInBatches(config, 'manual_trigger', undefined, 0)).resolves.toBe(0);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('schedules only the imported, eligible book ids in bounded batches', async () => {
    const { db, selectBuilder } = makeDb();
    selectBuilder.where.mockResolvedValueOnce([{ bookId: 2 }, { bookId: 3 }]).mockResolvedValueOnce([{ bookId: 7 }]);
    const repo = new BookMetadataFetchQueueRepository(db as never);
    vi.spyOn(repo, 'upsertSchedule').mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    const config = baseConfig();
    config.conditions.neverFetched.enabled = true;

    await expect(repo.scheduleEligibleBookIdsInBatches(config, 'event_import', 5, [2, 3, 3, 7, -1], 2)).resolves.toBe(3);

    expect(repo.upsertSchedule).toHaveBeenNthCalledWith(1, [2, 3], 'event_import');
    expect(repo.upsertSchedule).toHaveBeenNthCalledWith(2, [7], 'event_import');
    expect(inArray).toHaveBeenCalledWith(bookMetadata.bookId, [2, 3]);
    expect(inArray).toHaveBeenCalledWith(bookMetadata.bookId, [7]);
  });

  it('defers a processing row until import completion', async () => {
    const { db, updateBuilder } = makeDb();
    const repo = new BookMetadataFetchQueueRepository(db as never);

    await expect(repo.deferProcessing(18)).resolves.toBeUndefined();

    expect(updateBuilder.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'queued' }));
    expect(and).toHaveBeenCalledWith(expect.objectContaining({ op: 'eq' }), expect.objectContaining({ op: 'eq', right: 'processing' }));
  });

  it('getFailedItems maps nullable fields and returns total count', async () => {
    const failedRows = [
      {
        bookId: 10,
        title: null,
        libraryName: 'Main',
        error: 'provider timeout',
        httpStatus: 503,
        failedAt: new Date('2026-01-05T00:00:00.000Z'),
      },
    ];
    const totalRows = [{ cnt: '4' }];
    const failedItemsChain = {
      from: vi.fn(),
      leftJoin: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
      offset: vi.fn(),
    };
    failedItemsChain.from.mockReturnValue(failedItemsChain);
    failedItemsChain.leftJoin.mockReturnValue(failedItemsChain);
    failedItemsChain.where.mockReturnValue(failedItemsChain);
    failedItemsChain.orderBy.mockReturnValue(failedItemsChain);
    failedItemsChain.limit.mockReturnValue(failedItemsChain);
    failedItemsChain.offset.mockResolvedValue(failedRows);

    const totalChain = {
      from: vi.fn(),
      where: vi.fn(),
    };
    totalChain.from.mockReturnValue(totalChain);
    totalChain.where.mockResolvedValue(totalRows);

    const db = {
      select: vi.fn().mockReturnValueOnce(failedItemsChain).mockReturnValueOnce(totalChain),
    };
    const repo = new BookMetadataFetchQueueRepository(db as never);

    await expect(repo.getFailedItems(2, 10)).resolves.toEqual({
      items: [
        {
          bookId: 10,
          title: null,
          libraryName: 'Main',
          error: 'provider timeout',
          httpStatus: 503,
          failedAt: '2026-01-05T00:00:00.000Z',
        },
      ],
      total: 4,
    });
  });
});
