import { BookmarkRepository } from './bookmark.repository';

function makeRow(overrides?: Record<string, unknown>) {
  return {
    id: 1,
    userId: 10,
    bookId: 5,
    cfi: 'epubcfi(/6/2)',
    title: 'Chapter 1',
    positionSeconds: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeDb() {
  const selectResult = { from: vi.fn() };
  const fromResult = { where: vi.fn() };
  const whereResult = { orderBy: vi.fn() };
  const orderByResult = { limit: vi.fn() };

  selectResult.from.mockReturnValue(fromResult);
  fromResult.where.mockReturnValue(whereResult);
  whereResult.orderBy.mockResolvedValue([]);
  orderByResult.limit.mockResolvedValue([]);

  const insertResult = { values: vi.fn() };
  const valuesResult = { returning: vi.fn() };
  insertResult.values.mockReturnValue(valuesResult);
  valuesResult.returning.mockResolvedValue([]);

  const deleteResult = { where: vi.fn() };
  const deleteWhereResult = { returning: vi.fn() };
  deleteResult.where.mockReturnValue(deleteWhereResult);
  deleteWhereResult.returning.mockResolvedValue([]);

  const db = {
    select: vi.fn().mockReturnValue(selectResult),
    insert: vi.fn().mockReturnValue(insertResult),
    delete: vi.fn().mockReturnValue(deleteResult),
    _where: whereResult,
    _orderBy: orderByResult,
    _insert: insertResult,
    _values: valuesResult,
    _deleteWhere: deleteWhereResult,
  };
  return db;
}

function makeRepository() {
  const db = makeDb();
  const repo = new BookmarkRepository(db as never);
  return { repo, db };
}

describe('BookmarkRepository', () => {
  describe('findByBookId', () => {
    it('queries by book and user and applies deterministic ordering', async () => {
      const { repo, db } = makeRepository();
      const rows = [makeRow(), makeRow({ id: 2 })];
      db._where.orderBy.mockResolvedValue(rows);

      const result = await repo.findByBookId(5, 10);

      expect(result).toEqual(rows);
      expect(db._where.orderBy).toHaveBeenCalled();
    });
  });

  describe('findExistingByLocation', () => {
    it('returns first bookmark for duplicate CFI location', async () => {
      const { repo, db } = makeRepository();
      const row = makeRow();
      db._where.orderBy.mockReturnValue(db._orderBy);
      db._orderBy.limit.mockResolvedValue([row]);

      const result = await repo.findExistingByLocation(10, 5, { cfi: 'epubcfi(/6/2)', positionSeconds: null });

      expect(result).toEqual(row);
      expect(db._orderBy.limit).toHaveBeenCalledWith(1);
    });

    it('returns first bookmark for duplicate audio position', async () => {
      const { repo, db } = makeRepository();
      const row = makeRow({ id: 4, cfi: null, positionSeconds: 93.5 });
      db._where.orderBy.mockReturnValue(db._orderBy);
      db._orderBy.limit.mockResolvedValue([row]);

      const result = await repo.findExistingByLocation(10, 5, { cfi: null, positionSeconds: 93.5 });

      expect(result).toEqual(row);
      expect(db._orderBy.limit).toHaveBeenCalledWith(1);
    });

    it('returns null when no location fields are provided', async () => {
      const { repo, db } = makeRepository();

      const result = await repo.findExistingByLocation(10, 5, { cfi: null, positionSeconds: null });

      expect(result).toBeNull();
      expect(db.select).not.toHaveBeenCalled();
    });

    it('returns null when no duplicate exists', async () => {
      const { repo, db } = makeRepository();
      db._where.orderBy.mockReturnValue(db._orderBy);
      db._orderBy.limit.mockResolvedValue([]);

      const result = await repo.findExistingByLocation(10, 5, { cfi: 'epubcfi(/6/2)', positionSeconds: null });

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('inserts and returns created row', async () => {
      const { repo, db } = makeRepository();
      const row = makeRow({ id: 8, cfi: null, positionSeconds: 15, title: '00:00:15' });
      db._values.returning.mockResolvedValue([row]);

      const result = await repo.create(10, 5, { cfi: null, title: '00:00:15', positionSeconds: 15 });

      expect(db._insert.values).toHaveBeenCalledWith({ userId: 10, bookId: 5, cfi: null, title: '00:00:15', positionSeconds: 15 });
      expect(result).toEqual(row);
    });
  });

  describe('delete', () => {
    it('returns true when delete query returns at least one row', async () => {
      const { repo, db } = makeRepository();
      db._deleteWhere.returning.mockResolvedValue([{ id: 1 }]);

      const result = await repo.delete(5, 1, 10);

      expect(result).toBe(true);
    });

    it('returns false when no rows are deleted', async () => {
      const { repo, db } = makeRepository();
      db._deleteWhere.returning.mockResolvedValue([]);

      const result = await repo.delete(5, 999, 10);

      expect(result).toBe(false);
    });
  });
});
