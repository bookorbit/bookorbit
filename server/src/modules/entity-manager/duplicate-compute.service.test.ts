import { DuplicateComputeService } from './duplicate-compute.service';

const scope = { libraryIds: [3, 8] };

function flattenSql(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(flattenSql).join(' ');
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  return [flattenSql(record.value), flattenSql(record.queryChunks)].join(' ');
}

function makeService() {
  const where = vi.fn().mockResolvedValue([]);
  const from = vi.fn().mockReturnValue({ where });

  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoNothing, onConflictDoUpdate });
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where: updateWhere });

  const db = {
    select: vi.fn().mockReturnValue({ from }),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
    insert: vi.fn().mockReturnValue({ values }),
    update: vi.fn().mockReturnValue({ set }),
  };

  const service = new DuplicateComputeService(db as any);

  return {
    service,
    db,
    where,
    from,
    values,
    onConflictDoNothing,
    onConflictDoUpdate,
    set,
    updateWhere,
  };
}

describe('DuplicateComputeService', () => {
  describe('getStatus', () => {
    it('returns null when no row exists', async () => {
      const { service, where } = makeService();
      where.mockResolvedValue([]);

      await expect(service.getStatus('author')).resolves.toBeNull();
    });

    it('returns the first row when one exists', async () => {
      const { service, where } = makeService();
      const row = {
        entityType: 'author',
        isComputing: false,
        computedAt: new Date('2024-01-01T00:00:00.000Z'),
        totalPairs: 5,
        threshold: 0.7,
        totalCount: 10,
        processedCount: 10,
        errorMessage: null,
      };
      where.mockResolvedValue([row]);

      await expect(service.getStatus('author')).resolves.toBe(row);
    });
  });

  describe('triggerCompute', () => {
    it('skips inline entity types', async () => {
      const { service, db } = makeService();

      service.triggerCompute('publisher', {} as any, 0.7);
      await Promise.resolve();

      expect(db.insert).not.toHaveBeenCalled();
    });

    it('skips when a job is already running', () => {
      const { service, db } = makeService();
      (service as any).runningJobs.add('author');

      service.triggerCompute('author', {} as any, 0.7);

      expect(db.insert).not.toHaveBeenCalled();
    });

    it('skips when the strategy does not support batch computation', async () => {
      const { service, db } = makeService();

      service.triggerCompute('author', { entityType: 'author', isInline: false } as any, 0.7);

      await vi.waitFor(() => {
        expect(db.insert).not.toHaveBeenCalled();
        expect((service as any).runningJobs.has('author')).toBe(false);
      });
    });

    it('starts a compute job for supported non-inline strategies', async () => {
      const { service, db, onConflictDoUpdate } = makeService();
      const strategy = {
        entityType: 'author',
        isInline: false,
        getAllEntityIds: vi.fn().mockResolvedValue([]),
        computeCandidatePairsForBatch: vi.fn(),
      };

      service.triggerCompute('author', strategy as any, 0.72);

      await vi.waitFor(() => {
        expect(db.insert).toHaveBeenCalled();
        expect(onConflictDoUpdate).toHaveBeenCalled();
      });
    });
  });

  describe('invalidateCandidatesForEntities', () => {
    it('skips when no entity IDs are provided', async () => {
      const { service, db } = makeService();

      await service.invalidateCandidatesForEntities('author', []);

      expect(db.execute).not.toHaveBeenCalled();
    });

    it('executes delete SQL when entity IDs are provided', async () => {
      const { service, db } = makeService();

      await service.invalidateCandidatesForEntities('author', [1, 2]);

      expect(db.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('readCandidatePairs', () => {
    it('calls execute and returns rows', async () => {
      const { service, db } = makeService();
      db.execute.mockResolvedValue({ rows: [{ idA: 1, idB: 2, simScore: 0.9 }] });

      await expect(service.readCandidatePairs('author', 0.7, scope)).resolves.toEqual([{ idA: 1, idB: 2, simScore: 0.9 }]);
      expect(db.execute).toHaveBeenCalledTimes(1);

      const query = flattenSql(db.execute.mock.calls[0]![0]).replace(/\s+/g, ' ');
      expect(query).toContain('book_authors');
      expect(query.match(/scoped_relation/g)?.length).toBeGreaterThanOrEqual(4);
    });

    it('returns an empty array when no rows exist', async () => {
      const { service, db } = makeService();
      db.execute.mockResolvedValue({ rows: [] });

      await expect(service.readCandidatePairs('author', 0.7, scope)).resolves.toEqual([]);
    });

    it.each([
      ['author', 'book_authors'],
      ['genre', 'book_genres'],
      ['tag', 'book_tags'],
      ['narrator', 'book_narrators'],
      ['series', 'book_series_memberships'],
    ] as const)('scopes %s candidates through %s', async (entityType, relationTable) => {
      const { service, db } = makeService();

      await service.readCandidatePairs(entityType, 0.7, scope);

      expect(flattenSql(db.execute.mock.calls[0]![0])).toContain(relationTable);
    });

    it('returns no candidates without querying when no libraries are accessible', async () => {
      const { service, db } = makeService();

      await expect(service.readCandidatePairs('author', 0.7, { libraryIds: [] })).resolves.toEqual([]);

      expect(db.execute).not.toHaveBeenCalled();
    });

    it('does not serve inline entity types from the global candidate cache', async () => {
      const { service, db } = makeService();

      await expect(service.readCandidatePairs('publisher', 0.7, scope)).resolves.toEqual([]);

      expect(db.execute).not.toHaveBeenCalled();
    });
  });
});
