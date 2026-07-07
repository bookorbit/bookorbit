vi.mock('drizzle-orm', () => ({
  eq: vi.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  and: vi.fn((...conditions: unknown[]) => ({ op: 'and', conditions })),
  inArray: vi.fn((left: unknown, right: unknown[]) => ({ op: 'inArray', left, right })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ op: 'sql', text: strings.join(''), values })),
    {
      join: vi.fn((chunks: unknown[], separator: unknown) => ({ op: 'sql.join', chunks, separator })),
    },
  ),
}));

import { UserBookNoteRepository } from './user-book-note.repository';

function makeDb() {
  const selectBuilder = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  selectBuilder.from.mockReturnValue(selectBuilder);
  selectBuilder.where.mockReturnValue(selectBuilder);
  selectBuilder.limit.mockResolvedValue([]);

  const insertBuilder = {
    values: vi.fn(),
    onConflictDoUpdate: vi.fn(),
    returning: vi.fn(),
  };
  insertBuilder.values.mockReturnValue(insertBuilder);
  insertBuilder.onConflictDoUpdate.mockReturnValue(insertBuilder);
  insertBuilder.returning.mockResolvedValue([]);

  return {
    db: {
      select: vi.fn().mockReturnValue(selectBuilder),
      insert: vi.fn().mockReturnValue(insertBuilder),
    },
    selectBuilder,
    insertBuilder,
  };
}

describe('UserBookNoteRepository', () => {
  it('findOne returns null when no note row exists', async () => {
    const { db } = makeDb();
    const repo = new UserBookNoteRepository(db as never);

    await expect(repo.findOne(1, 10)).resolves.toBeNull();
  });

  it('findOne returns the matching row', async () => {
    const { db, selectBuilder } = makeDb();
    const repo = new UserBookNoteRepository(db as never);
    const row = { userId: 1, bookId: 10, note: 'Great read', updatedAt: new Date('2026-01-01T00:00:00.000Z') };
    selectBuilder.limit.mockResolvedValue([row]);

    await expect(repo.findOne(1, 10)).resolves.toEqual(row);
  });

  it('findByBookIds short-circuits an empty id list without querying', async () => {
    const { db } = makeDb();
    const repo = new UserBookNoteRepository(db as never);

    await expect(repo.findByBookIds(1, [])).resolves.toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('findByBookIds returns rows scoped to the given user and book ids', async () => {
    const { db, selectBuilder } = makeDb();
    const repo = new UserBookNoteRepository(db as never);
    const rows = [{ userId: 1, bookId: 10, note: 'a', updatedAt: new Date() }];
    selectBuilder.where.mockResolvedValue(rows);

    await expect(repo.findByBookIds(1, [10, 20])).resolves.toEqual(rows);
  });

  it('upsert writes the note and returns the persisted row', async () => {
    const { db, insertBuilder } = makeDb();
    const repo = new UserBookNoteRepository(db as never);
    const updatedAt = new Date('2026-02-01T00:00:00.000Z');
    const row = { userId: 1, bookId: 10, note: 'Great read', updatedAt };
    insertBuilder.returning.mockResolvedValue([row]);

    await expect(repo.upsert(1, 10, 'Great read', updatedAt)).resolves.toEqual(row);
    expect(insertBuilder.values).toHaveBeenCalledWith({ userId: 1, bookId: 10, note: 'Great read', updatedAt });
    expect(insertBuilder.onConflictDoUpdate).toHaveBeenCalledWith(expect.objectContaining({ set: { note: 'Great read', updatedAt } }));
  });

  it('upsert supports clearing a note to null', async () => {
    const { db, insertBuilder } = makeDb();
    const repo = new UserBookNoteRepository(db as never);
    const updatedAt = new Date('2026-02-02T00:00:00.000Z');
    insertBuilder.returning.mockResolvedValue([{ userId: 1, bookId: 10, note: null, updatedAt }]);

    await expect(repo.upsert(1, 10, null, updatedAt)).resolves.toEqual({ userId: 1, bookId: 10, note: null, updatedAt });
  });
});
