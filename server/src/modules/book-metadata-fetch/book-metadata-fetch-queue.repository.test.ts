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
    isNull: vi.fn((value: unknown) => ({ op: 'isNull', value })),
    or: vi.fn((...clauses: unknown[]) => ({ op: 'or', clauses })),
    sql: sqlFn,
  };
});

import { and, eq, sql } from 'drizzle-orm';
import type { BookMetadataFetchConfig } from '@projectx/types';

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
});
