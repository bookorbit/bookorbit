import { AnnotationRepository } from './annotation.repository';

function makeRow(overrides?: Record<string, unknown>) {
  return {
    id: 1,
    userId: 10,
    bookId: 5,
    cfi: 'epubcfi(/6/4!/4/2/1:0)',
    cfiStatus: 'exact',
    text: 'selected text',
    color: 'yellow',
    style: 'highlight',
    note: null,
    chapterTitle: null,
    origin: 'web',
    version: 1,
    deletedAt: null,
    deviceCreatedAt: null,
    deviceUpdatedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

type ChainQuery = Record<string, ReturnType<typeof vi.fn>> & {
  then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => Promise<unknown>;
};

function mockQuery(result: unknown): ChainQuery {
  const query = {} as ChainQuery;
  const methods = [
    'from',
    'leftJoin',
    'innerJoin',
    'where',
    'orderBy',
    'limit',
    'offset',
    'groupBy',
    'values',
    'set',
    'returning',
    'onConflictDoUpdate',
  ];
  for (const method of methods) {
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
  const db = {
    select: vi.fn().mockImplementation(next),
    selectDistinct: vi.fn().mockImplementation(next),
    insert: vi.fn().mockImplementation(next),
    update: vi.fn().mockImplementation(next),
    delete: vi.fn().mockImplementation(next),
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
    _queries: queries,
  };
  return db;
}

describe('AnnotationRepository', () => {
  describe('findByBookId', () => {
    it('queries with filters and returns the joined rows', async () => {
      const rows = [makeRow(), makeRow({ id: 2 })];
      const db = makeDb(rows);
      const repo = new AnnotationRepository(db as never);

      const result = await repo.findByBookId(5, 10);

      expect(db.select).toHaveBeenCalled();
      expect(db._queries[0].leftJoin).toHaveBeenCalled();
      expect(db._queries[0].orderBy).toHaveBeenCalled();
      expect(result).toEqual(rows);
    });

    it('returns empty array when no annotations match', async () => {
      const db = makeDb([]);
      const repo = new AnnotationRepository(db as never);

      const result = await repo.findByBookId(5, 10);

      expect(result).toEqual([]);
    });
  });

  describe('create', () => {
    it('inserts the annotation and its cfi position in a transaction', async () => {
      const row = makeRow();
      const db = makeDb([row], []);
      const repo = new AnnotationRepository(db as never);

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

      expect(db.transaction).toHaveBeenCalled();
      expect(db.insert).toHaveBeenCalledTimes(2);
      const positionValues = db._queries[1].values.mock.calls[0][0] as Record<string, unknown>;
      expect(positionValues).toMatchObject({ annotationId: 1, format: 'cfi', pos0: 'epubcfi(/6/4!/4/2/1:0)', status: 'exact' });
      expect(result).toMatchObject({ ...row, cfi: 'epubcfi(/6/4!/4/2/1:0)', cfiStatus: 'exact' });
    });

    it('does not leak the cfi into the annotations insert payload', async () => {
      const db = makeDb([makeRow()], []);
      const repo = new AnnotationRepository(db as never);

      await repo.create({
        userId: 10,
        bookId: 5,
        cfi: 'epubcfi(/6/4)',
        text: 'text',
        color: 'yellow',
        style: 'highlight',
        note: 'my note',
        chapterTitle: null,
      });

      const annotationValues = db._queries[0].values.mock.calls[0][0] as Record<string, unknown>;
      expect(annotationValues).not.toHaveProperty('cfi');
      expect(annotationValues).toMatchObject({ note: 'my note' });
    });
  });

  describe('update', () => {
    it('bumps the version and re-reads the row with its position', async () => {
      const updated = makeRow({ note: 'updated', version: 2 });
      const db = makeDb([{ id: 1 }], [updated]);
      const repo = new AnnotationRepository(db as never);

      const result = await repo.update(5, 1, 10, { note: 'updated' });

      const setCall = db._queries[0].set.mock.calls[0][0] as Record<string, unknown>;
      expect(setCall).toHaveProperty('version');
      expect(setCall).toHaveProperty('updatedAt');
      expect(result).toEqual(updated);
    });

    it('returns null when annotation does not exist or belongs to different user/book', async () => {
      const db = makeDb([]);
      const repo = new AnnotationRepository(db as never);

      const result = await repo.update(5, 99, 10, { note: 'x' });

      expect(result).toBeNull();
    });
  });

  describe('softDelete', () => {
    it('marks the row deleted instead of removing it', async () => {
      const db = makeDb([{ id: 1 }]);
      const repo = new AnnotationRepository(db as never);

      const result = await repo.softDelete(5, 1, 10);

      expect(db.update).toHaveBeenCalled();
      expect(db.delete).not.toHaveBeenCalled();
      const setCall = db._queries[0].set.mock.calls[0][0] as Record<string, unknown>;
      expect(setCall).toHaveProperty('deletedAt');
      expect(setCall).toHaveProperty('version');
      expect(result).toBe(true);
    });

    it('returns false when nothing matched', async () => {
      const db = makeDb([]);
      const repo = new AnnotationRepository(db as never);

      const result = await repo.softDelete(5, 99, 10);

      expect(result).toBe(false);
    });
  });

  describe('restore', () => {
    it('clears deletedAt and bumps the version', async () => {
      const restored = makeRow({ version: 3 });
      const db = makeDb([restored]);
      const repo = new AnnotationRepository(db as never);

      const result = await repo.restore(1, 10);

      const setCall = db._queries[0].set.mock.calls[0][0] as Record<string, unknown>;
      expect(setCall).toMatchObject({ deletedAt: null });
      expect(setCall).toHaveProperty('version');
      expect(result).toEqual(restored);
    });

    it('returns null when the annotation is not trashed', async () => {
      const db = makeDb([]);
      const repo = new AnnotationRepository(db as never);

      const result = await repo.restore(1, 10);

      expect(result).toBeNull();
    });
  });

  // purge calls db.delete first, then builds the notExists subquery via db.select
  // inside .where(), so the second queued result belongs to that subquery builder.
  describe('purge', () => {
    it('hard-deletes when every device acked the deletion', async () => {
      const db = makeDb([{ id: 1 }], []);
      const repo = new AnnotationRepository(db as never);

      const result = await repo.purge(1, 10);

      expect(db.delete).toHaveBeenCalled();
      expect(result).toBe('purged');
    });

    it('reports pending_device_sync when unacked device state blocks the purge', async () => {
      const db = makeDb([], [], [{ id: 1 }]);
      const repo = new AnnotationRepository(db as never);

      const result = await repo.purge(1, 10);

      expect(result).toBe('pending_device_sync');
    });

    it('reports not_found when no trashed row exists', async () => {
      const db = makeDb([], [], []);
      const repo = new AnnotationRepository(db as never);

      const result = await repo.purge(1, 10);

      expect(result).toBe('not_found');
    });
  });

  describe('findPaginated', () => {
    it('returns items and total count', async () => {
      const db = makeDb([makeRow()], [{ count: 1 }]);
      const repo = new AnnotationRepository(db as never);

      const result = await repo.findPaginated(5, 10, {}, { by: 'position', dir: 'asc' }, 1, 25);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('returns empty result when no annotations match', async () => {
      const db = makeDb([], [{ count: 0 }]);
      const repo = new AnnotationRepository(db as never);

      const result = await repo.findPaginated(5, 10, {}, { by: 'position', dir: 'asc' }, 1, 25);

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('applies offset based on page and pageSize', async () => {
      const db = makeDb([], [{ count: 0 }]);
      const repo = new AnnotationRepository(db as never);

      await repo.findPaginated(5, 10, {}, { by: 'position', dir: 'asc' }, 3, 10);

      expect(db._queries[0].offset).toHaveBeenCalledWith(20);
    });
  });

  describe('getStats', () => {
    it('returns aggregated stats', async () => {
      const db = makeDb(
        [{ totalHighlights: 5, chaptersWithHighlights: 2, highlightsWithNotes: 3 }],
        [
          { color: 'yellow', count: 3 },
          { color: '#4ADE80', count: 2 },
        ],
        [
          { origin: 'web', count: 4 },
          { origin: 'koreader', count: 1 },
        ],
      );
      const repo = new AnnotationRepository(db as never);

      const result = await repo.getStats(5, 10, {});

      expect(result.totalHighlights).toBe(5);
      expect(result.chaptersWithHighlights).toBe(2);
      expect(result.highlightsWithNotes).toBe(3);
      expect(result.colorBreakdown).toEqual([
        { color: 'yellow', count: 3 },
        { color: '#4ADE80', count: 2 },
      ]);
      expect(result.originBreakdown).toEqual([
        { origin: 'web', count: 4 },
        { origin: 'koreader', count: 1 },
      ]);
    });

    it('returns zero stats when no annotations exist', async () => {
      const db = makeDb([{ totalHighlights: 0, chaptersWithHighlights: 0, highlightsWithNotes: 0 }], [], []);
      const repo = new AnnotationRepository(db as never);

      const result = await repo.getStats(5, 10, {});

      expect(result.totalHighlights).toBe(0);
      expect(result.colorBreakdown).toEqual([]);
      expect(result.originBreakdown).toEqual([]);
    });
  });

  describe('getDistinctChapters', () => {
    it('returns distinct chapter titles', async () => {
      const db = makeDb([{ chapterTitle: 'Chapter 1' }, { chapterTitle: 'Chapter 2' }]);
      const repo = new AnnotationRepository(db as never);

      const result = await repo.getDistinctChapters(5, 10);

      expect(result).toEqual(['Chapter 1', 'Chapter 2']);
    });

    it('filters out null chapter titles', async () => {
      const db = makeDb([{ chapterTitle: null }, { chapterTitle: 'Chapter 1' }]);
      const repo = new AnnotationRepository(db as never);

      const result = await repo.getDistinctChapters(5, 10);

      expect(result).toEqual(['Chapter 1']);
    });
  });
});
