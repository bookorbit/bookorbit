vi.mock('drizzle-orm', () => ({
  eq: vi.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  inArray: vi.fn((left: unknown, right: unknown[]) => ({ op: 'inArray', left, right })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ op: 'sql', text: strings.join(''), values })),
    {
      join: vi.fn((chunks: unknown[], separator: unknown) => ({ op: 'sql.join', chunks, separator })),
    },
  ),
}));

import { BookMetadataLockRepository } from './book-metadata-lock.repository';

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
  };
  insertBuilder.values.mockReturnValue(insertBuilder);
  insertBuilder.onConflictDoUpdate.mockResolvedValue(undefined);

  return {
    db: {
      select: vi.fn().mockReturnValue(selectBuilder),
      insert: vi.fn().mockReturnValue(insertBuilder),
    },
    selectBuilder,
    insertBuilder,
  };
}

describe('BookMetadataLockRepository', () => {
  it('findLockedFields returns an empty list when metadata row is missing', async () => {
    const { db } = makeDb();
    const repo = new BookMetadataLockRepository(db as never);

    await expect(repo.findLockedFields(11)).resolves.toEqual([]);
  });

  it('findLockedFieldsByBookIds short-circuits empty ids and maps rows by book id', async () => {
    const { db, selectBuilder } = makeDb();
    const repo = new BookMetadataLockRepository(db as never);

    await expect(repo.findLockedFieldsByBookIds([])).resolves.toEqual(new Map());
    expect(db.select).not.toHaveBeenCalled();

    selectBuilder.where.mockResolvedValueOnce([
      { bookId: 1, lockedFields: ['title'] },
      { bookId: 2, lockedFields: null },
    ]);
    await expect(repo.findLockedFieldsByBookIds([1, 2])).resolves.toEqual(
      new Map([
        [1, ['title']],
        [2, []],
      ]),
    );
  });

  it('replaceLockedFields upserts lock array and timestamp', async () => {
    const { db, insertBuilder } = makeDb();
    const repo = new BookMetadataLockRepository(db as never);

    await repo.replaceLockedFields(20, ['title', 'authors']);

    expect(db.insert).toHaveBeenCalled();
    expect(insertBuilder.values).toHaveBeenCalledWith(
      expect.objectContaining({
        bookId: 20,
        lockedFields: ['title', 'authors'],
        updatedAt: expect.any(Date),
      }),
    );
    expect(insertBuilder.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          lockedFields: ['title', 'authors'],
          updatedAt: expect.any(Date),
        }),
      }),
    );
  });
});
