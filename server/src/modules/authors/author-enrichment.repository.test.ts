vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  asc: vi.fn((value: unknown) => ({ op: 'asc', value })),
  count: vi.fn(() => ({ op: 'count' })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  inArray: vi.fn((left: unknown, right: unknown[]) => ({ op: 'inArray', left, right })),
  isNull: vi.fn((value: unknown) => ({ op: 'isNull', value })),
  lte: vi.fn((left: unknown, right: unknown) => ({ op: 'lte', left, right })),
  or: vi.fn((...clauses: unknown[]) => ({ op: 'or', clauses })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ op: 'sql', text: strings.join(''), values })),
}));

import { and, eq, inArray, lte, or } from 'drizzle-orm';

import { authorEnrichmentQueue } from '../../db/schema';
import { AUTHOR_ENRICHMENT_ACTIVE_STATUSES, AuthorEnrichmentRepository } from './author-enrichment.repository';

describe('AuthorEnrichmentRepository', () => {
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
      orderBy: vi.fn(),
      limit: vi.fn(),
      groupBy: vi.fn(),
      leftJoin: vi.fn(),
      offset: vi.fn(),
    };
    selectBuilder.from.mockReturnValue(selectBuilder);
    selectBuilder.where.mockReturnValue(selectBuilder);
    selectBuilder.orderBy.mockReturnValue(selectBuilder);
    selectBuilder.leftJoin.mockReturnValue(selectBuilder);
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

    return {
      insertBuilder,
      selectBuilder,
      updateBuilder,
      db: {
        insert: vi.fn().mockReturnValue(insertBuilder),
        select: vi.fn().mockReturnValue(selectBuilder),
        selectDistinct: vi.fn().mockReturnValue(selectBuilder),
        update: vi.fn().mockReturnValue(updateBuilder),
      },
    };
  };

  it('upsertSchedule dedupes valid author ids and resets queued state', async () => {
    const { db, insertBuilder } = makeDb();
    insertBuilder.returning.mockResolvedValueOnce([{ authorId: 3 }, { authorId: 4 }]);
    const repo = new AuthorEnrichmentRepository(db as never);

    const count = await repo.upsertSchedule([3, 3, 4, -1, 0], 'metadata_replace');

    expect(count).toBe(2);
    expect(db.insert).toHaveBeenCalledWith(authorEnrichmentQueue);
    expect(insertBuilder.values).toHaveBeenCalledWith([
      expect.objectContaining({ authorId: 3, status: 'queued', reason: 'metadata_replace', attemptCount: 0 }),
      expect.objectContaining({ authorId: 4, status: 'queued', reason: 'metadata_replace', attemptCount: 0 }),
    ]);
    expect(insertBuilder.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: authorEnrichmentQueue.authorId,
        set: expect.objectContaining({ status: 'queued', reason: 'metadata_replace', attemptCount: 0 }),
      }),
    );
  });

  it('fetchDue filters by active statuses and due time', async () => {
    const { db, selectBuilder } = makeDb();
    const repo = new AuthorEnrichmentRepository(db as never);

    await repo.fetchDue(5);

    expect(inArray).toHaveBeenCalledWith(authorEnrichmentQueue.status, [...AUTHOR_ENRICHMENT_ACTIVE_STATUSES]);
    expect(lte).toHaveBeenCalledWith(authorEnrichmentQueue.nextAttemptAt, expect.any(Date));
    expect(and).toHaveBeenCalled();
    expect(selectBuilder.limit).toHaveBeenCalledWith(5);
  });

  it('markProcessing only transitions rows that are due and active', async () => {
    const { db, updateBuilder } = makeDb();
    updateBuilder.returning.mockResolvedValueOnce([{ authorId: 12 }]);
    const repo = new AuthorEnrichmentRepository(db as never);

    await expect(repo.markProcessing(12)).resolves.toBe(true);
    expect(eq).toHaveBeenCalledWith(authorEnrichmentQueue.authorId, 12);
    expect(inArray).toHaveBeenCalledWith(authorEnrichmentQueue.status, [...AUTHOR_ENRICHMENT_ACTIVE_STATUSES]);
    expect(lte).toHaveBeenCalledWith(authorEnrichmentQueue.nextAttemptAt, expect.any(Date));
    expect(updateBuilder.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'processing', lastAttemptAt: expect.any(Date) }));
  });

  it('markProcessing returns false when unique processing guard is already occupied', async () => {
    const { db, updateBuilder } = makeDb();
    const repo = new AuthorEnrichmentRepository(db as never);
    updateBuilder.returning.mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: '23505' }));

    await expect(repo.markProcessing(55)).resolves.toBe(false);
  });

  it('markFailed sets queued/rate-limited/final states correctly', async () => {
    const { db, updateBuilder } = makeDb();
    const repo = new AuthorEnrichmentRepository(db as never);

    await repo.markFailed({
      authorId: 9,
      error: 'rate limited',
      httpStatus: 429,
      nextAttemptAt: new Date('2026-04-05T12:00:00.000Z'),
      rateLimited: true,
    });
    expect(updateBuilder.set).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'rate_limited',
        lastHttpStatus: 429,
      }),
    );

    await repo.markFailed({
      authorId: 9,
      error: 'temporary',
      httpStatus: 503,
      nextAttemptAt: new Date('2026-04-05T12:05:00.000Z'),
      rateLimited: false,
    });
    expect(updateBuilder.set).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'queued',
        lastHttpStatus: 503,
      }),
    );

    await repo.markFailed({
      authorId: 9,
      error: 'permanent',
      httpStatus: null,
      nextAttemptAt: null,
      rateLimited: false,
    });
    expect(updateBuilder.set).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'failed',
        lastHttpStatus: null,
      }),
    );
  });

  it('recoverStuckProcessing requeues only stale processing rows', async () => {
    const { db, updateBuilder } = makeDb();
    updateBuilder.returning.mockResolvedValueOnce([{ authorId: 11 }, { authorId: 22 }]);
    const repo = new AuthorEnrichmentRepository(db as never);

    const recovered = await repo.recoverStuckProcessing(new Date('2026-04-05T12:00:00.000Z'));

    expect(recovered).toBe(2);
    expect(eq).toHaveBeenCalledWith(authorEnrichmentQueue.status, 'processing');
    expect(or).toHaveBeenCalled();
    expect(updateBuilder.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'queued',
        nextAttemptAt: expect.any(Date),
      }),
    );
  });

  it('getStatusSummary maps grouped queue statuses to typed counters', async () => {
    const { db, selectBuilder } = makeDb();
    selectBuilder.groupBy.mockResolvedValue([
      { status: 'queued', cnt: 4 },
      { status: 'processing', cnt: 1 },
      { status: 'rate_limited', cnt: 2 },
      { status: 'failed', cnt: 3 },
      { status: 'done', cnt: 10 },
    ]);

    const repo = new AuthorEnrichmentRepository(db as never);
    await expect(repo.getStatusSummary()).resolves.toEqual({
      queued: 4,
      processing: 1,
      rateLimited: 2,
      failed: 3,
      done: 0,
      total: 10,
    });
  });
});
