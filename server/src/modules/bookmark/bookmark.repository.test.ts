import { BookmarkRepository } from './bookmark.repository';

function makeRow(overrides?: Record<string, unknown>) {
  return {
    id: 1,
    userId: 10,
    bookId: 5,
    cfi: 'epubcfi(/6/2)',
    title: 'Chapter 1',
    positionSeconds: null,
    origin: 'web',
    devicePos: null,
    pageno: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
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
  const valuesResult = { onConflictDoNothing: vi.fn() };
  const conflictResult = { returning: vi.fn() };
  insertResult.values.mockReturnValue(valuesResult);
  valuesResult.onConflictDoNothing.mockReturnValue(conflictResult);
  conflictResult.returning.mockResolvedValue([]);

  const updateResult = { set: vi.fn() };
  const setResult = { where: vi.fn() };
  const updateWhereResult = { returning: vi.fn() };
  updateResult.set.mockReturnValue(setResult);
  setResult.where.mockReturnValue(updateWhereResult);
  updateWhereResult.returning.mockResolvedValue([]);

  const deleteResult = { where: vi.fn() };
  const deleteWhereResult = { returning: vi.fn() };
  deleteResult.where.mockReturnValue(deleteWhereResult);
  deleteWhereResult.returning.mockResolvedValue([]);

  const db = {
    select: vi.fn().mockReturnValue(selectResult),
    insert: vi.fn().mockReturnValue(insertResult),
    update: vi.fn().mockReturnValue(updateResult),
    delete: vi.fn().mockReturnValue(deleteResult),
    _where: whereResult,
    _orderBy: orderByResult,
    _insert: insertResult,
    _values: valuesResult,
    _conflict: conflictResult,
    _update: updateResult,
    _updateWhere: updateWhereResult,
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

  describe('findLiveByLocation', () => {
    it('returns first bookmark for duplicate CFI location', async () => {
      const { repo, db } = makeRepository();
      const row = makeRow();
      db._where.orderBy.mockReturnValue(db._orderBy);
      db._orderBy.limit.mockResolvedValue([row]);

      const result = await repo.findLiveByLocation(10, 5, { cfi: 'epubcfi(/6/2)', positionSeconds: null });

      expect(result).toEqual(row);
      expect(db._orderBy.limit).toHaveBeenCalledWith(1);
    });

    it('returns first bookmark for duplicate audio position', async () => {
      const { repo, db } = makeRepository();
      const row = makeRow({ id: 4, cfi: null, positionSeconds: 93.5 });
      db._where.orderBy.mockReturnValue(db._orderBy);
      db._orderBy.limit.mockResolvedValue([row]);

      const result = await repo.findLiveByLocation(10, 5, { cfi: null, positionSeconds: 93.5 });

      expect(result).toEqual(row);
      expect(db._orderBy.limit).toHaveBeenCalledWith(1);
    });

    it('returns null when no location fields are provided', async () => {
      const { repo, db } = makeRepository();

      const result = await repo.findLiveByLocation(10, 5, { cfi: null, positionSeconds: null });

      expect(result).toBeNull();
      expect(db.select).not.toHaveBeenCalled();
    });

    it('returns null when no duplicate exists', async () => {
      const { repo, db } = makeRepository();
      db._where.orderBy.mockReturnValue(db._orderBy);
      db._orderBy.limit.mockResolvedValue([]);

      const result = await repo.findLiveByLocation(10, 5, { cfi: 'epubcfi(/6/2)', positionSeconds: null });

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('inserts and returns created row', async () => {
      const { repo, db } = makeRepository();
      const row = makeRow({ id: 8, cfi: null, positionSeconds: 15, title: '00:00:15' });
      db._conflict.returning.mockResolvedValue([row]);

      const result = await repo.create(10, 5, { cfi: null, title: '00:00:15', positionSeconds: 15 });

      expect(db._insert.values).toHaveBeenCalledWith({ userId: 10, bookId: 5, cfi: null, title: '00:00:15', positionSeconds: 15 });
      expect(db._values.onConflictDoNothing).toHaveBeenCalledTimes(1);
      expect(result).toEqual(row);
    });

    it('returns null when a duplicate insert is ignored by the database', async () => {
      const { repo, db } = makeRepository();
      db._conflict.returning.mockResolvedValue([]);

      const result = await repo.create(10, 5, { cfi: 'epubcfi(/6/2)', title: 'Chapter 1', positionSeconds: null });

      expect(result).toBeNull();
    });
  });

  describe('restoreAtLocation', () => {
    it('clears the tombstone and rewrites the row fields', async () => {
      const { repo, db } = makeRepository();
      const row = makeRow({ deletedAt: null, origin: 'koreader', devicePos: '/body/DocFragment[2]' });
      db._updateWhere.returning.mockResolvedValue([row]);

      const result = await repo.restoreAtLocation(
        10,
        5,
        { cfi: 'epubcfi(/6/2)', positionSeconds: null },
        { title: 'Chapter 1', origin: 'koreader', devicePos: '/body/DocFragment[2]', pageno: 12 },
      );

      expect(db._update.set).toHaveBeenCalledWith({
        title: 'Chapter 1',
        origin: 'koreader',
        devicePos: '/body/DocFragment[2]',
        pageno: 12,
        deletedAt: null,
      });
      expect(result).toEqual(row);
    });

    it('returns null without querying when the location is empty', async () => {
      const { repo, db } = makeRepository();

      const result = await repo.restoreAtLocation(
        10,
        5,
        { cfi: null, positionSeconds: null },
        { title: 'x', origin: 'web', devicePos: null, pageno: null },
      );

      expect(result).toBeNull();
      expect(db.update).not.toHaveBeenCalled();
    });
  });

  describe('softDelete', () => {
    it('returns true when a live row was tombstoned', async () => {
      const { repo, db } = makeRepository();
      db._updateWhere.returning.mockResolvedValue([{ id: 1 }]);

      const result = await repo.softDelete(5, 1, 10);

      expect(result).toBe(true);
      expect(db.delete).not.toHaveBeenCalled();
    });

    it('returns false when nothing matched', async () => {
      const { repo, db } = makeRepository();
      db._updateWhere.returning.mockResolvedValue([]);

      const result = await repo.softDelete(5, 999, 10);

      expect(result).toBe(false);
    });
  });

  describe('sync operations', () => {
    it('lists a bounded, tombstone-inclusive working set', async () => {
      const { repo, db } = makeRepository();
      const rows = [makeRow(), makeRow({ id: 2, deletedAt: new Date('2026-02-01T00:00:00Z') })];
      db._where.orderBy.mockReturnValue(db._orderBy);
      db._orderBy.limit.mockResolvedValue(rows);

      const result = await repo.listForSync(10, 5, 500);

      expect(result).toEqual(rows);
      expect(db._orderBy.limit).toHaveBeenCalledWith(500);
    });

    it('inserts a device bookmark with its canonical device position', async () => {
      const { repo, db } = makeRepository();
      const row = makeRow({ origin: 'koreader' });
      db._conflict.returning.mockResolvedValue([row]);

      const result = await repo.createFromDevice(10, 5, {
        cfi: 'epubcfi(/6/2)',
        title: 'Chapter 1',
        devicePos: '/body/DocFragment[2]/body/p[3]/text().0',
        pageno: 12,
      });

      expect(db._insert.values).toHaveBeenCalledWith({
        userId: 10,
        bookId: 5,
        cfi: 'epubcfi(/6/2)',
        title: 'Chapter 1',
        origin: 'koreader',
        devicePos: '/body/DocFragment[2]/body/p[3]/text().0',
        pageno: 12,
      });
      expect(result).toEqual(row);
    });

    it('skips the tombstone update when no ids are given', async () => {
      const { repo, db } = makeRepository();

      expect(await repo.tombstone(10, [])).toBe(0);
      expect(db.update).not.toHaveBeenCalled();
    });

    it('counts tombstoned rows', async () => {
      const { repo, db } = makeRepository();
      db._updateWhere.returning.mockResolvedValue([{ id: 3 }, { id: 4 }]);

      expect(await repo.tombstone(10, [3, 4])).toBe(2);
    });

    it('skips the purge delete when no ids are given', async () => {
      const { repo, db } = makeRepository();

      expect(await repo.purge(10, [])).toBe(0);
      expect(db.delete).not.toHaveBeenCalled();
    });

    it('hard deletes purgeable tombstones', async () => {
      const { repo, db } = makeRepository();
      db._deleteWhere.returning.mockResolvedValue([{ id: 7 }]);

      expect(await repo.purge(10, [7])).toBe(1);
    });

    it('returns purge candidate ids oldest first', async () => {
      const { repo, db } = makeRepository();
      db._where.orderBy.mockReturnValue(db._orderBy);
      db._orderBy.limit.mockResolvedValue([{ id: 3 }, { id: 9 }]);

      const result = await repo.listPurgeableTombstones(10, new Date('2026-01-01T00:00:00Z'), 50);

      expect(result).toEqual([3, 9]);
      expect(db._orderBy.limit).toHaveBeenCalledWith(50);
    });
  });
});
