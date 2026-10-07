import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { bookJournalEntries } from '../../db/schema';
import { BookJournalRepository } from './book-journal.repository';

const CLIENT_ID = '4f9c7a52-3d1e-4b6a-9a51-0c2f6e8d7b13';

type ChainQuery = Record<string, ReturnType<typeof vi.fn>> & {
  then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => Promise<unknown>;
};

function mockQuery(result: unknown): ChainQuery {
  const query = {} as ChainQuery;
  for (const method of ['from', 'where', 'orderBy', 'limit', 'values', 'set', 'returning', 'onConflictDoNothing']) {
    query[method] = vi.fn().mockReturnValue(query);
  }
  query.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return query;
}

function makeDb(...results: unknown[]) {
  const queue = [...results];
  const queries: ChainQuery[] = [];
  const next = () => {
    const query = mockQuery(queue.length > 0 ? queue.shift() : []);
    queries.push(query);
    return query;
  };
  return {
    select: vi.fn().mockImplementation(next),
    insert: vi.fn().mockImplementation(next),
    update: vi.fn().mockImplementation(next),
    delete: vi.fn().mockImplementation(next),
    _queries: queries,
  };
}

function whereSql(query: ChainQuery): { sql: string; params: unknown[] } {
  const compiled = new PgDialect().sqlToQuery(query.where.mock.calls[0][0] as SQL);
  return { sql: compiled.sql, params: compiled.params };
}

describe('BookJournalRepository', () => {
  it('lists active entries for one user and book, oldest first, capped', async () => {
    const db = makeDb([{ id: 1 }]);
    const repo = new BookJournalRepository(db as never);

    const rows = await repo.findByBook(7, 5, 'active', 2000);

    expect(rows).toEqual([{ id: 1 }]);
    const query = db._queries[0];
    const { sql, params } = whereSql(query);
    expect(sql).toContain('"book_journal_entries"."user_id" = $1');
    expect(sql).toContain('"book_journal_entries"."book_id" = $2');
    expect(sql).toContain('"book_journal_entries"."deleted_at" is null');
    expect(params).toEqual([7, 5]);
    const order = query.orderBy.mock.calls[0].map((fragment: SQL) => new PgDialect().sqlToQuery(fragment).sql);
    expect(order).toEqual(['"book_journal_entries"."created_at" asc', '"book_journal_entries"."id" asc']);
    expect(query.limit).toHaveBeenCalledWith(2000);
  });

  it('lists only trashed entries for the trashed status', async () => {
    const db = makeDb([]);
    const repo = new BookJournalRepository(db as never);

    await repo.findByBook(7, 5, 'trashed', 2000);

    expect(whereSql(db._queries[0]).sql).toContain('"book_journal_entries"."deleted_at" is not null');
  });

  it('looks a client id up for the caller only, across books', async () => {
    const db = makeDb([]);
    const repo = new BookJournalRepository(db as never);

    await expect(repo.findByClientId(7, CLIENT_ID)).resolves.toBeNull();

    const { sql, params } = whereSql(db._queries[0]);
    expect(sql).toContain('"book_journal_entries"."user_id" = $1');
    expect(sql).toContain('"book_journal_entries"."client_id" = $2');
    expect(sql).not.toContain('book_id');
    expect(params).toEqual([7, CLIENT_ID]);
  });

  it('inserts without overwriting an existing client id', async () => {
    const row = { id: 3 };
    const db = makeDb([row]);
    const repo = new BookJournalRepository(db as never);
    const values = { clientId: CLIENT_ID, userId: 7, bookId: 5, body: 'x' };

    await expect(repo.insert(values)).resolves.toEqual(row);

    const query = db._queries[0];
    expect(db.insert).toHaveBeenCalledWith(bookJournalEntries);
    expect(query.values).toHaveBeenCalledWith(values);
    expect(query.onConflictDoNothing).toHaveBeenCalledWith({ target: [bookJournalEntries.userId, bookJournalEntries.clientId] });
  });

  it('returns null from insert when the client id already exists', async () => {
    const db = makeDb([]);
    const repo = new BookJournalRepository(db as never);

    await expect(repo.insert({ clientId: CLIENT_ID, userId: 7, bookId: 5, body: 'x' })).resolves.toBeNull();
  });

  it('updates only an active entry the caller owns on that book', async () => {
    const db = makeDb([{ id: 1 }]);
    const repo = new BookJournalRepository(db as never);

    await repo.updateActive(7, 5, CLIENT_ID, { body: 'edited' });

    const query = db._queries[0];
    expect(query.set).toHaveBeenCalledWith({ body: 'edited' });
    const { sql, params } = whereSql(query);
    expect(sql).toContain('"book_journal_entries"."user_id" = $1');
    expect(sql).toContain('"book_journal_entries"."book_id" = $2');
    expect(sql).toContain('"book_journal_entries"."client_id" = $3');
    expect(sql).toContain('"book_journal_entries"."deleted_at" is null');
    expect(params).toEqual([7, 5, CLIENT_ID]);
  });

  describe('trash', () => {
    it('reports trashed when the entry moved', async () => {
      const db = makeDb([{ id: 1 }]);
      const repo = new BookJournalRepository(db as never);

      await expect(repo.trash(7, 5, CLIENT_ID)).resolves.toBe('trashed');
      expect(db._queries[0].set).toHaveBeenCalledWith({ deletedAt: expect.any(Date) });
      expect(whereSql(db._queries[0]).sql).toContain('"book_journal_entries"."deleted_at" is null');
      expect(db.select).not.toHaveBeenCalled();
    });

    it('reports already_trashed when the entry exists but was not active', async () => {
      const db = makeDb([], [{ id: 1 }]);
      const repo = new BookJournalRepository(db as never);

      await expect(repo.trash(7, 5, CLIENT_ID)).resolves.toBe('already_trashed');
      expect(whereSql(db._queries[1]).params).toEqual([7, 5, CLIENT_ID]);
    });

    it('reports not_found when nothing matches', async () => {
      const db = makeDb([], []);
      const repo = new BookJournalRepository(db as never);

      await expect(repo.trash(7, 5, CLIENT_ID)).resolves.toBe('not_found');
    });
  });

  it('restores only a trashed entry', async () => {
    const db = makeDb([]);
    const repo = new BookJournalRepository(db as never);

    await expect(repo.restore(7, 5, CLIENT_ID)).resolves.toBeNull();
    expect(db._queries[0].set).toHaveBeenCalledWith({ deletedAt: null });
    expect(whereSql(db._queries[0]).sql).toContain('"book_journal_entries"."deleted_at" is not null');
  });

  it('purges only a trashed entry', async () => {
    const db = makeDb([{ id: 1 }]);
    const repo = new BookJournalRepository(db as never);

    await expect(repo.purge(7, 5, CLIENT_ID)).resolves.toBe(true);
    expect(db.delete).toHaveBeenCalledWith(bookJournalEntries);
    const { sql, params } = whereSql(db._queries[0]);
    expect(sql).toContain('"book_journal_entries"."deleted_at" is not null');
    expect(params).toEqual([7, 5, CLIENT_ID]);
  });

  it('reports false when there is nothing in the trash to purge', async () => {
    const db = makeDb([]);
    const repo = new BookJournalRepository(db as never);

    await expect(repo.purge(7, 5, CLIENT_ID)).resolves.toBe(false);
  });
});
