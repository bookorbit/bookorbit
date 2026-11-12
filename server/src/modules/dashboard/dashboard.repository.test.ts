import { drizzle } from 'drizzle-orm/node-postgres';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

import * as schema from '../../db/schema';
import { DashboardRepository } from './dashboard.repository';
import { audiobookProgress, bookFiles, books, readingProgress, userBookStatus } from '../../db/schema';

function makeLimitChain<T>(rows: T) {
  const chain: Record<string, vi.Mock> = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockResolvedValue(rows);
  return chain;
}

function makeBoundsChain(minId: number | null, maxId: number | null) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockResolvedValue([{ minId, maxId }]);
  return chain;
}

function collectValues(value: unknown, seen = new WeakSet<object>()): unknown[] {
  if (value === null || typeof value !== 'object') return [value];
  if (seen.has(value)) return [];
  seen.add(value);

  const values: unknown[] = [];
  if ('value' in value) values.push((value as { value: unknown }).value);
  for (const key of Object.getOwnPropertyNames(value)) {
    values.push(...collectValues((value as Record<string, unknown>)[key], seen));
  }
  return values;
}

function compileSql(value: unknown): string {
  return new PgDialect()
    .sqlToQuery(value as SQL)
    .sql.replaceAll(/\s+/g, ' ')
    .trim();
}

describe('DashboardRepository', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('returns empty results without querying when no libraries are accessible', async () => {
    const db = { select: vi.fn(), execute: vi.fn() };
    const repo = new DashboardRepository(db as never);

    await expect(repo.findRecentlyAddedBookIds([], 20)).resolves.toEqual([]);
    await expect(repo.findContinueReadingBookIds([], 1, 20)).resolves.toEqual([]);
    await expect(repo.findContinueListeningBookIds([], 1, 20)).resolves.toEqual([]);
    await expect(repo.findWantToReadBookIds([], 1, 20)).resolves.toEqual([]);
    await expect(repo.findUpNextInSeriesBookIds([], 1, 20)).resolves.toEqual([]);
    await expect(repo.findRandomBookIds([], 1, 20)).resolves.toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('maps recently added rows to id list', async () => {
    const listChain = makeLimitChain([{ id: 5 }, { id: 2 }]);
    const db = { select: vi.fn().mockReturnValue(listChain) };
    const repo = new DashboardRepository(db as never);

    const result = await repo.findRecentlyAddedBookIds([10], 2);

    expect(result).toEqual([5, 2]);
    expect(listChain.limit).toHaveBeenCalledWith(2);
  });

  it('maps continue-reading rows to id list and excludes unread plus terminal read statuses', async () => {
    const listChain = makeLimitChain([{ id: 40 }, { id: 9 }]);
    const db = { select: vi.fn().mockReturnValue(listChain) };
    const repo = new DashboardRepository(db as never);

    const result = await repo.findContinueReadingBookIds([8], 55, 10);
    const whereArg = listChain.where.mock.calls[0]?.[0];
    const whereValues = collectValues(whereArg);

    expect(result).toEqual([40, 9]);
    expect(listChain.leftJoin).toHaveBeenCalledTimes(3);
    expect(listChain.leftJoin.mock.calls[0]?.[0]).toBe(bookFiles);
    expect(listChain.leftJoin.mock.calls[1]?.[0]).toBe(readingProgress);
    expect(listChain.leftJoin.mock.calls[2]?.[0]).toBe(userBookStatus);
    expect(listChain.leftJoin.mock.calls.some((call) => call[0] === audiobookProgress)).toBe(false);
    expect(whereValues).toEqual(expect.arrayContaining(['unread', 'read', 'skimmed', 'abandoned']));
    expect(listChain.innerJoin).not.toHaveBeenCalled();
    expect(listChain.orderBy).toHaveBeenCalledTimes(1);
    expect(listChain.limit).toHaveBeenCalledWith(10);
  });

  describe('continue listening', () => {
    /** A repository over a database with no client: it records the SQL each query compiles to and answers with `rows`. */
    function repositoryAnswering(rows: unknown[]) {
      const db = drizzle.mock({ schema });
      const queries: { sql: string; params: unknown[] }[] = [];
      vi.spyOn((db as unknown as { session: { prepareQuery: (...args: unknown[]) => unknown } }).session, 'prepareQuery').mockImplementation(
        (query: unknown) => {
          const { sql, params } = query as { sql: string; params: unknown[] };
          queries.push({ sql: sql.replaceAll(/\s+/g, ' '), params });
          const prepared = { setToken: () => prepared, execute: () => Promise.resolve(rows) };
          return prepared;
        },
      );
      return { repo: new DashboardRepository(db as never), queries };
    }

    it('lists audiobooks and played read-along narration, newest listening first, without unread or terminal statuses', async () => {
      const { repo, queries } = repositoryAnswering([{ id: 41 }, { id: 10 }]);

      await expect(repo.findContinueListeningBookIds([8], 55, 10)).resolves.toEqual([41, 10]);

      const { sql, params } = queries[0]!;
      expect(sql).toContain('"audiobook_progress"');
      expect(sql).toContain(' union all ');
      expect(sql).toContain('"book_files"."media_overlay_available" = $');
      expect(sql).toContain('lower("book_files"."format") = \'epub\'');
      expect(sql).toContain('"reading_progress"."narration_percentage" > 0 and "reading_progress"."narration_percentage" < 100');
      expect(sql).toContain('group by "books"."id"');
      expect(sql).toContain('order by max("listened_at") desc, "books"."id" desc');
      expect(params).toEqual(expect.arrayContaining([55, 8, 10, 'unread', 'read', 'skimmed', 'abandoned']));
    });

    // Reading moves the narration marker to the page and clears its seconds. Only playing the
    // narration leaves them, so only that counts as listening.
    it('counts narration only when playing it saved the position', async () => {
      const { repo, queries } = repositoryAnswering([{ id: 41 }]);

      await repo.findContinueListeningBookIds([8], 55, 10);

      const narration = queries[0]!.sql.split(' union all ')[1] ?? '';
      expect(narration).toContain('"reading_progress"."position_seconds" is not null');
      expect(narration).toContain('"reading_progress"."narration_updated_at" is not null');
    });

    it('counts each book once when it has an audiobook and narration under way', async () => {
      const { repo, queries } = repositoryAnswering([{ value: 3 }]);

      await expect(repo.countContinueListeningBooks([8], 55)).resolves.toBe(3);

      expect(queries[0]!.sql).toContain('count(distinct "books"."id")');
      expect(queries[0]!.sql).toContain(' union all ');
    });
  });

  it('maps want-to-read rows to id list and joins user status', async () => {
    const listChain = makeLimitChain([{ id: 77 }, { id: 12 }]);
    const db = { select: vi.fn().mockReturnValue(listChain) };
    const repo = new DashboardRepository(db as never);

    const result = await repo.findWantToReadBookIds([12], 55, 6);

    expect(result).toEqual([77, 12]);
    expect(listChain.innerJoin).toHaveBeenCalledTimes(1);
    expect(listChain.innerJoin.mock.calls[0]?.[0]).toBe(userBookStatus);
    expect(listChain.leftJoin).not.toHaveBeenCalled();
    expect(listChain.orderBy).toHaveBeenCalledTimes(1);
    expect(listChain.limit).toHaveBeenCalledWith(6);
  });

  it('returns empty random ids when there are no candidates', async () => {
    const boundsChain = makeBoundsChain(1, 100);
    const listChain = makeLimitChain([]);
    const db = {
      select: vi.fn().mockReturnValueOnce(boundsChain).mockReturnValue(listChain),
      execute: vi.fn().mockResolvedValue({ rows: [] }),
    };
    const repo = new DashboardRepository(db as never);

    const result = await repo.findRandomBookIds([5], 7, 20);

    expect(result).toEqual([]);
    expect(db.select).toHaveBeenCalledTimes(3);
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(listChain.leftJoin).not.toHaveBeenCalled();
    expect(listChain.orderBy).toHaveBeenCalledTimes(2);
    expect(listChain.limit).toHaveBeenCalledTimes(2);
    expect(listChain.limit).toHaveBeenNthCalledWith(1, 20);
    expect(listChain.limit).toHaveBeenNthCalledWith(2, 20);
  });

  it('samples random rows from independent pivots and excludes active or finished read statuses', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const boundsChain = makeBoundsChain(1, 100);
    const subqueryChain = makeLimitChain([]);
    const db = {
      select: vi.fn().mockReturnValueOnce(boundsChain).mockReturnValue(subqueryChain),
      execute: vi.fn().mockResolvedValue({
        rows: [
          { sampleIndex: 0, id: 21 },
          { sampleIndex: 1, id: 3 },
          { sampleIndex: 2, id: 15 },
        ],
      }),
    };
    const repo = new DashboardRepository(db as never);

    const result = await repo.findRandomBookIds([5], 7, 3);
    const query = new PgDialect().sqlToQuery(db.execute.mock.calls[0]?.[0] as SQL);
    const queryText = query.sql.replaceAll(/\s+/g, ' ');

    expect(result).toEqual([21, 3, 15]);
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(query.params).toEqual(expect.arrayContaining(['reading', 'rereading', 'on_hold', 'read', 'skimmed', 'abandoned']));
    // The forward and wrap probes each carry the progress, status and series subqueries, and every
    // one must reach PostgreSQL with its OFFSET 0 or it is flattened into a rescanning anti-join.
    expect(queryText).toMatch(
      /not exists \( select 1 from "reading_progress" where "reading_progress"\."book_file_id" = "books"\."primary_file_id" and .*? offset 0 \)/,
    );
    expect(queryText).toMatch(
      /not exists \( select 1 from "user_book_status" where "user_book_status"\."book_id" = "books"\."id" and .*? offset 0 \)/,
    );
    expect(queryText.match(/offset 0/g)).toHaveLength(6);
    expect(queryText).not.toContain('left join "user_book_status"');
    expect(queryText).toContain('where forward_candidate.id is null');
    expect(queryText).toContain('order by "books"."id" desc');
    expect(Math.random).toHaveBeenCalledTimes(9);
  });

  it('bounds each pivot by the next one and lets only the highest wrap', async () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.5).mockReturnValueOnce(0.1).mockReturnValueOnce(0.5);
    const boundsChain = makeBoundsChain(1, 100);
    const subqueryChain = makeLimitChain([]);
    const db = {
      select: vi.fn().mockReturnValueOnce(boundsChain).mockReturnValue(subqueryChain),
      execute: vi.fn().mockResolvedValue({ rows: [{ sampleIndex: 1, id: 12 }] }),
    };
    const repo = new DashboardRepository(db as never);

    await repo.findRandomBookIds([5], 7, 1);
    const query = new PgDialect().sqlToQuery(db.execute.mock.calls[0]?.[0] as SQL);
    const queryText = query.sql.replaceAll(/\s+/g, ' ');

    expect(query.params.slice(0, 12)).toEqual([1, 11, 50, false, 0, 51, 50, false, 2, 51, 2147483647, true]);
    expect(queryText).toContain('"books"."id" >= p.pivot_id and "books"."id" <= p.last_id');
    expect(queryText).toContain('where forward_candidate.id is null and p.wraps and');
  });

  it('only offers a series at its first present volume in the library', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const boundsChain = makeBoundsChain(1, 100);
    const subqueryChain = makeLimitChain([]);
    const db = {
      select: vi.fn().mockReturnValueOnce(boundsChain).mockReturnValue(subqueryChain),
      execute: vi.fn().mockResolvedValue({ rows: [{ sampleIndex: 0, id: 4 }] }),
    };
    const repo = new DashboardRepository(db as never);

    await repo.findRandomBookIds([5], 7, 1);
    const queryText = compileSql(db.execute.mock.calls[0]?.[0]);

    expect(queryText).toContain('not exists ( select 1 from "book_metadata" candidate_metadata');
    expect(queryText).toContain('inner join "book_metadata" earlier_metadata on earlier_metadata.series_id = candidate_metadata.series_id');
    expect(queryText).toContain('split_part(earlier_metadata.series_index::text');
    expect(queryText).toContain('where candidate_metadata.book_id = "books"."id"');
    expect(queryText).toContain('earlier_book.library_id = "books"."library_id"');
    expect(queryText).toContain("earlier_book.status = 'present' offset 0 )");
  });

  it('caps distributed candidate probes for large limits', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const boundsChain = makeBoundsChain(1, 1000);
    const subqueryChain = makeLimitChain([]);
    const db = {
      select: vi.fn().mockReturnValueOnce(boundsChain).mockReturnValue(subqueryChain),
      execute: vi.fn().mockResolvedValue({
        rows: Array.from({ length: 50 }, (_, index) => ({ sampleIndex: index, id: index + 1 })),
      }),
    };
    const repo = new DashboardRepository(db as never);

    await expect(repo.findRandomBookIds([5], 7, 50)).resolves.toHaveLength(50);

    expect(Math.random).toHaveBeenCalledTimes(60);
  });

  it('fills a sparse distributed sample from the nearest lower ids', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const boundsChain = makeBoundsChain(1, 100);
    const afterPivot = makeLimitChain([]);
    const beforePivot = makeLimitChain([{ id: 9 }, { id: 2 }]);
    const db = {
      select: vi.fn().mockReturnValueOnce(boundsChain).mockReturnValueOnce(afterPivot).mockReturnValueOnce(beforePivot),
      execute: vi.fn().mockResolvedValue({
        rows: [
          { sampleIndex: 0, id: 100 },
          { sampleIndex: 1, id: 100 },
          { sampleIndex: 2, id: 100 },
        ],
      }),
    };
    const repo = new DashboardRepository(db as never);

    const result = await repo.findRandomBookIds([5], 7, 3);

    expect(result).toEqual([100, 9, 2]);
    expect(afterPivot.limit).toHaveBeenCalledWith(2);
    expect(beforePivot.limit).toHaveBeenCalledWith(2);
    expect(collectValues(afterPivot.orderBy.mock.calls[0]?.[0])).toContain(' asc');
    expect(collectValues(beforePivot.orderBy.mock.calls[0]?.[0])).toContain(' desc');
    expect(beforePivot.orderBy.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ queryChunks: expect.arrayContaining([books.id]) }));
  });

  it('returns empty random ids and does not query when limit is zero', async () => {
    const db = { select: vi.fn() };
    const repo = new DashboardRepository(db as never);

    const result = await repo.findRandomBookIds([3, 4], 99, 0);

    expect(result).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('maps up-next-in-series rows to id list', async () => {
    const db = {
      select: vi.fn(),
      execute: vi.fn().mockResolvedValue({ rows: [{ id: 17 }, { id: 4 }] }),
    };
    const repo = new DashboardRepository(db as never);

    const result = await repo.findUpNextInSeriesBookIds([9], 55, 10);

    expect(result).toEqual([17, 4]);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('offers only up-next volumes with no read status, unread or want to read, gated after the series window', async () => {
    const db = {
      select: vi.fn(),
      execute: vi.fn().mockResolvedValue({ rows: [] }),
    };
    const repo = new DashboardRepository(db as never);

    await repo.findUpNextInSeriesBookIds([9], 55, 10);
    const query = compileSql(db.execute.mock.calls[0]?.[0]);
    const gate = "and (os.read_status is null or os.read_status in ('unread', 'want_to_read'))";

    expect(query).toContain('"user_book_status"."status" as read_status');
    expect(query).toContain('ssb.read_status');
    expect(query.indexOf(gate)).toBeGreaterThan(query.indexOf('from ordered_series os'));
    expect(query.split(gate)).toHaveLength(2);
  });

  it('returns empty up-next-in-series ids and does not query when limit is zero', async () => {
    const db = {
      select: vi.fn(),
      execute: vi.fn(),
    };
    const repo = new DashboardRepository(db as never);

    const result = await repo.findUpNextInSeriesBookIds([9], 55, 0);

    expect(result).toEqual([]);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('returns empty up-next-in-series ids when query returns no rows', async () => {
    const db = {
      select: vi.fn(),
      execute: vi.fn().mockResolvedValue({ rows: [] }),
    };
    const repo = new DashboardRepository(db as never);

    const result = await repo.findUpNextInSeriesBookIds([2], 101, 20);

    expect(result).toEqual([]);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});
