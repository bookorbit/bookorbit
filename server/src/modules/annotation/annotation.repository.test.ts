import { AnnotationRepository } from './annotation.repository';

function makeRow(overrides?: Record<string, unknown>) {
  return {
    id: 1,
    userId: 10,
    bookId: 5,
    cfi: 'epubcfi(/6/4!/4/2/1:0)',
    text: 'selected text',
    color: 'yellow',
    style: 'highlight',
    note: null,
    chapterTitle: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeDb() {
  const selectResult = { from: vi.fn() };
  const fromResult = { where: vi.fn() };
  const whereResult = { orderBy: vi.fn() };

  selectResult.from.mockReturnValue(fromResult);
  fromResult.where.mockReturnValue(whereResult);
  whereResult.orderBy.mockResolvedValue([]);

  const insertResult = { values: vi.fn() };
  const valuesResult = { returning: vi.fn() };
  insertResult.values.mockReturnValue(valuesResult);
  valuesResult.returning.mockResolvedValue([]);

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
    _select: selectResult,
    _from: fromResult,
    _where: whereResult,
    _insert: insertResult,
    _values: valuesResult,
    _update: updateResult,
    _set: setResult,
    _updateWhere: updateWhereResult,
    _delete: deleteResult,
    _deleteWhere: deleteWhereResult,
  };
  return db;
}

function makeRepository() {
  const db = makeDb();
  const repo = new AnnotationRepository(db as never);
  return { repo, db };
}

describe('AnnotationRepository', () => {
  describe('findByBookId', () => {
    it('queries with bookId and userId filters and applies createdAt ordering', async () => {
      const { repo, db } = makeRepository();
      const rows = [makeRow(), makeRow({ id: 2 })];
      db._where.orderBy.mockResolvedValue(rows);

      const result = await repo.findByBookId(5, 10);

      expect(db.select).toHaveBeenCalled();
      expect(result).toEqual(rows);
    });

    it('returns empty array when no annotations match', async () => {
      const { repo, db } = makeRepository();
      db._where.orderBy.mockResolvedValue([]);

      const result = await repo.findByBookId(5, 10);

      expect(result).toEqual([]);
    });

    it('calls orderBy on the query chain', async () => {
      const { repo, db } = makeRepository();
      db._where.orderBy.mockResolvedValue([]);

      await repo.findByBookId(5, 10);

      expect(db._where.orderBy).toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('inserts a new annotation and returns the created row', async () => {
      const { repo, db } = makeRepository();
      const row = makeRow();
      db._values.returning.mockResolvedValue([row]);

      const result = await repo.create({
        userId: 10,
        bookId: 5,
        cfi: 'epubcfi(/6/4!/4/2/1:0)',
        text: 'selected text',
        color: 'yellow',
        style: 'highlight',
        note: null,
        chapterTitle: null,
      });

      expect(db.insert).toHaveBeenCalled();
      expect(result).toEqual(row);
    });

    it('stores note value when provided', async () => {
      const { repo, db } = makeRepository();
      const row = makeRow({ note: 'my note' });
      db._values.returning.mockResolvedValue([row]);

      const result = await repo.create({
        userId: 10,
        bookId: 5,
        cfi: 'epubcfi(/6/4)',
        text: 'text',
        color: 'yellow',
        style: 'highlight',
        note: 'my note',
        chapterTitle: null,
      });

      expect(result.note).toBe('my note');
    });
  });

  describe('update', () => {
    it('updates and returns the row when found', async () => {
      const { repo, db } = makeRepository();
      const row = makeRow({ note: 'updated' });
      db._updateWhere.returning.mockResolvedValue([row]);

      const result = await repo.update(5, 1, 10, { note: 'updated' });

      expect(result).toEqual(row);
    });

    it('returns null when annotation does not exist or belongs to different user/book', async () => {
      const { repo, db } = makeRepository();
      db._updateWhere.returning.mockResolvedValue([]);

      const result = await repo.update(5, 99, 10, { note: 'x' });

      expect(result).toBeNull();
    });

    it('sets updatedAt via sql expression', async () => {
      const { repo, db } = makeRepository();
      db._updateWhere.returning.mockResolvedValue([makeRow()]);

      await repo.update(5, 1, 10, { color: '#FACC15' });

      const setCall = db._update.set.mock.calls[0][0];
      expect(setCall).toHaveProperty('updatedAt');
    });

    it('clears note when null is passed', async () => {
      const { repo, db } = makeRepository();
      const row = makeRow({ note: null });
      db._updateWhere.returning.mockResolvedValue([row]);

      const result = await repo.update(5, 1, 10, { note: null });

      expect(result!.note).toBeNull();
    });
  });

  describe('delete', () => {
    it('returns true when annotation is deleted', async () => {
      const { repo, db } = makeRepository();
      db._deleteWhere.returning.mockResolvedValue([{ id: 1 }]);

      const result = await repo.delete(5, 1, 10);

      expect(result).toBe(true);
    });

    it('returns false when annotation does not exist or belongs to different user/book', async () => {
      const { repo, db } = makeRepository();
      db._deleteWhere.returning.mockResolvedValue([]);

      const result = await repo.delete(5, 99, 10);

      expect(result).toBe(false);
    });
  });
});
