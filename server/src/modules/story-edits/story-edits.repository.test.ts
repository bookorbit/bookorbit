import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import type { StoryEditRow } from '../../db/schema';
import { STORY_EDITS_WRITE_LOCK_NAMESPACE, StoryEditsRepository, type StoryEditWrite } from './story-edits.repository';

const EDIT_ID = '4f9c7a52-3d1e-4b6a-9a51-0c2f6e8d7b13';
const dialect = new PgDialect();

type ChainQuery = Record<string, ReturnType<typeof vi.fn>> & {
  then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => Promise<unknown>;
};

function mockQuery(result: unknown): ChainQuery {
  const query = {} as ChainQuery;
  for (const method of ['from', 'where', 'orderBy', 'limit', 'values', 'set', 'returning']) {
    query[method] = vi.fn().mockReturnValue(query);
  }
  query.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return query;
}

function makeDb(...results: unknown[]) {
  const queue = [...results];
  const calls: Array<{ kind: 'select' | 'insert' | 'update'; query: ChainQuery }> = [];
  const next = (kind: 'select' | 'insert' | 'update') => () => {
    const query = mockQuery(queue.length > 0 ? queue.shift() : []);
    calls.push({ kind, query });
    return query;
  };
  const db = {
    select: vi.fn().mockImplementation(next('select')),
    selectDistinct: vi.fn().mockImplementation(next('select')),
    insert: vi.fn().mockImplementation(next('insert')),
    update: vi.fn().mockImplementation(next('update')),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn(),
    calls,
  };
  db.transaction.mockImplementation((work: (tx: typeof db) => Promise<unknown>) => work(db));
  return db;
}

function compiled(fragment: unknown): { sql: string; params: unknown[] } {
  const query = dialect.sqlToQuery(fragment as SQL);
  return { sql: query.sql, params: query.params };
}

function stored(overrides: Partial<StoryEditRow> = {}): StoryEditRow {
  return {
    userId: 8,
    bookId: 5,
    id: EDIT_ID,
    kind: 'merge',
    data: { from: 'Strider' },
    position: 0.1,
    clientUpdatedAt: new Date('2026-11-06T10:00:00.000Z'),
    deleted: false,
    revision: 3,
    createdAt: new Date('2026-11-06T10:00:00.000Z'),
    updatedAt: new Date('2026-11-06T10:00:00.000Z'),
    ...overrides,
  };
}

function write(overrides: Partial<StoryEditWrite> = {}): StoryEditWrite {
  return {
    userId: 8,
    bookId: 5,
    id: EDIT_ID,
    kind: 'rename',
    data: { name: 'Aragorn' },
    position: 0.5,
    clientUpdatedAt: new Date('2026-11-06T12:00:00.000Z'),
    deleted: false,
    ...overrides,
  };
}

describe('StoryEditsRepository', () => {
  describe('listSince', () => {
    it("reads one reader's rows for one book after the cursor, in revision order", async () => {
      const db = makeDb([stored()]);
      const repo = new StoryEditsRepository(db as never);

      await expect(repo.listSince(8, 5, 40, 201)).resolves.toEqual([stored()]);

      const query = db.calls[0]!.query;
      const where = compiled(query.where.mock.calls[0][0]);
      expect(where.sql).toBe('("story_edits"."user_id" = $1 and "story_edits"."book_id" = $2 and "story_edits"."revision" > $3)');
      expect(where.params).toEqual([8, 5, 40]);
      expect(compiled(query.orderBy.mock.calls[0][0]).sql).toBe('"story_edits"."revision" asc');
      expect(query.limit).toHaveBeenCalledWith(201);
    });
  });

  describe('redrawRevisions', () => {
    it("draws new revisions for each reader's rows on the book, each under that reader's write lock", async () => {
      const db = makeDb([{ userId: 7 }, { userId: 8 }]);
      const repo = new StoryEditsRepository(db as never);

      await expect(repo.redrawRevisions(5)).resolves.toBe(2);

      expect(db.transaction).toHaveBeenCalledTimes(2);
      expect(db.execute.mock.calls.map(([fragment]) => compiled(fragment).params)).toEqual([
        [STORY_EDITS_WRITE_LOCK_NAMESPACE, 7],
        [STORY_EDITS_WRITE_LOCK_NAMESPACE, 8],
      ]);
      const updates = db.calls.filter((call) => call.kind === 'update').map((call) => call.query);
      expect(updates).toHaveLength(2);
      expect(compiled((updates[0]!.set.mock.calls[0][0] as { revision: unknown }).revision).sql).toBe(
        `nextval(pg_get_serial_sequence('story_edits', 'revision'))`,
      );
      expect(compiled(updates[1]!.where.mock.calls[0][0]).params).toEqual([8, 5]);
    });

    it('does nothing for a book without corrections', async () => {
      const db = makeDb([]);
      const repo = new StoryEditsRepository(db as never);

      await expect(repo.redrawRevisions(5)).resolves.toBe(0);
      expect(db.transaction).not.toHaveBeenCalled();
    });
  });

  describe('write', () => {
    it('takes the per-user write lock before reading anything', async () => {
      const db = makeDb([], [{ value: 0 }], [stored()]);
      const repo = new StoryEditsRepository(db as never);

      await repo.write(write(), 2000);

      const lock = compiled(db.execute.mock.calls[0][0]);
      expect(lock.sql).toBe('select pg_advisory_xact_lock($1, $2)');
      expect(lock.params).toEqual([STORY_EDITS_WRITE_LOCK_NAMESPACE, 8]);
      expect(db.execute.mock.invocationCallOrder[0]).toBeLessThan(db.select.mock.invocationCallOrder[0]!);
    });

    it('inserts a new correction under the cap', async () => {
      const inserted = stored({ kind: 'rename', revision: 12 });
      const db = makeDb([], [{ value: 1999 }], [inserted]);
      const repo = new StoryEditsRepository(db as never);

      await expect(repo.write(write(), 2000)).resolves.toEqual({ outcome: 'written', row: inserted });

      const insert = db.calls.find((call) => call.kind === 'insert')!.query;
      expect(insert.values).toHaveBeenCalledWith({
        userId: 8,
        bookId: 5,
        id: EDIT_ID,
        kind: 'rename',
        data: { name: 'Aragorn' },
        position: 0.5,
        clientUpdatedAt: new Date('2026-11-06T12:00:00.000Z'),
        deleted: false,
      });
      const countWhere = compiled(db.calls[1]!.query.where.mock.calls[0][0]);
      expect(countWhere.sql).toContain('"story_edits"."deleted" = $3');
      expect(countWhere.params).toEqual([8, 5, false]);
    });

    it('refuses a new live correction once the book holds the cap', async () => {
      const db = makeDb([], [{ value: 2000 }]);
      const repo = new StoryEditsRepository(db as never);

      await expect(repo.write(write(), 2000)).resolves.toEqual({ outcome: 'refused' });
      expect(db.insert).not.toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
    });

    it('stores a tombstone for an id it has never seen even at the cap, without counting', async () => {
      const tombstone = stored({ deleted: true });
      const db = makeDb([], [tombstone]);
      const repo = new StoryEditsRepository(db as never);

      await expect(repo.write(write({ deleted: true }), 2000)).resolves.toEqual({ outcome: 'written', row: tombstone });
      expect(db.select).toHaveBeenCalledTimes(1);
      expect(db.insert).toHaveBeenCalledTimes(1);
    });

    it('overwrites an older stored row and draws it a new revision', async () => {
      const updated = stored({ kind: 'rename', revision: 14 });
      const db = makeDb([stored()], [updated]);
      const repo = new StoryEditsRepository(db as never);

      await expect(repo.write(write(), 2000)).resolves.toEqual({ outcome: 'written', row: updated });

      const update = db.calls.find((call) => call.kind === 'update')!.query;
      const { revision, ...fields } = update.set.mock.calls[0][0] as Record<string, unknown>;
      expect(fields).toEqual({
        kind: 'rename',
        data: { name: 'Aragorn' },
        position: 0.5,
        clientUpdatedAt: new Date('2026-11-06T12:00:00.000Z'),
        deleted: false,
      });
      expect(compiled(revision).sql).toBe(`nextval(pg_get_serial_sequence('story_edits', 'revision'))`);
      const where = compiled(update.where.mock.calls[0][0]);
      expect(where.sql).toBe('("story_edits"."user_id" = $1 and "story_edits"."book_id" = $2 and "story_edits"."id" = $3)');
      expect(where.params).toEqual([8, 5, EDIT_ID]);
    });

    it('lets a write with the same client time as the stored row win', async () => {
      const db = makeDb([stored({ clientUpdatedAt: new Date('2026-11-06T12:00:00.000Z') })], [stored({ revision: 15 })]);
      const repo = new StoryEditsRepository(db as never);

      await expect(repo.write(write(), 2000)).resolves.toMatchObject({ outcome: 'written' });
      expect(db.update).toHaveBeenCalledTimes(1);
    });

    it('keeps a stored row that is newer than the write, untouched', async () => {
      const newer = stored({ clientUpdatedAt: new Date('2026-11-06T12:00:00.001Z') });
      const db = makeDb([newer]);
      const repo = new StoryEditsRepository(db as never);

      await expect(repo.write(write(), 2000)).resolves.toEqual({ outcome: 'kept', row: newer });
      expect(db.update).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('keeps a newer tombstone against an older edit that arrives late', async () => {
      const tombstone = stored({ deleted: true, clientUpdatedAt: new Date('2026-11-06T13:00:00.000Z') });
      const db = makeDb([tombstone]);
      const repo = new StoryEditsRepository(db as never);

      await expect(repo.write(write({ deleted: false }), 2000)).resolves.toEqual({ outcome: 'kept', row: tombstone });
    });

    it('updates an existing row at the cap, because the cap only refuses new rows', async () => {
      const db = makeDb([stored({ deleted: true })], [stored({ revision: 16 })]);
      const repo = new StoryEditsRepository(db as never);

      await expect(repo.write(write(), 0)).resolves.toMatchObject({ outcome: 'written' });
      expect(db.select).toHaveBeenCalledTimes(1);
    });
  });
});
