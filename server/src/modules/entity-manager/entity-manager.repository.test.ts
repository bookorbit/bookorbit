import { EntityManagerRepository } from './entity-manager.repository';

function makeRepo() {
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  const where = vi.fn().mockResolvedValue([]);
  const from = vi.fn().mockReturnValue({ where });

  const db = {
    insert: vi.fn().mockReturnValue({ values }),
    delete: vi.fn().mockReturnValue({ where }),
    select: vi.fn().mockReturnValue({ from }),
    execute: vi.fn().mockResolvedValue(undefined),
  };

  return { repo: new EntityManagerRepository(db as any), db, values, onConflictDoNothing, where };
}

describe('EntityManagerRepository', () => {
  describe('insertDismissedPair', () => {
    it('canonicalizes IDs so smaller comes first', async () => {
      const { repo, db, values } = makeRepo();
      await repo.insertDismissedPair('author', 10, 5, 'reason', 1);

      expect(db.insert).toHaveBeenCalled();
      const insertValues = values.mock.calls[0]![0];
      expect(insertValues.entityIdA).toBe(5);
      expect(insertValues.entityIdB).toBe(10);
    });

    it('calls onConflictDoNothing', async () => {
      const { repo, onConflictDoNothing } = makeRepo();
      await repo.insertDismissedPair('genre', 1, 2, undefined, 1);

      expect(onConflictDoNothing).toHaveBeenCalled();
    });

    it('passes null when reason is undefined', async () => {
      const { repo, values } = makeRepo();
      await repo.insertDismissedPair('tag', 1, 2, undefined, 1);

      expect(values.mock.calls[0]![0].reason).toBeNull();
    });
  });

  describe('deleteDismissedPair', () => {
    it('canonicalizes IDs before delete', async () => {
      const { repo, db } = makeRepo();
      await repo.deleteDismissedPair('author', 20, 10);

      expect(db.delete).toHaveBeenCalled();
    });
  });

  describe('deleteDismissedPairsForEntity', () => {
    it('executes raw SQL for delete', async () => {
      const { repo, db } = makeRepo();
      await repo.deleteDismissedPairsForEntity('genre', 5);

      expect(db.execute).toHaveBeenCalled();
    });
  });

  describe('getDismissedPairSet', () => {
    it('returns set with both orderings of pair keys', async () => {
      const { repo, where } = makeRepo();
      where.mockResolvedValue([{ id: 1, entityIdA: 10, entityIdB: 20, reason: null, dismissedAt: new Date() }]);

      const result = await repo.getDismissedPairSet('author');

      expect(result.has('10:20')).toBe(true);
      expect(result.has('20:10')).toBe(true);
      expect(result.size).toBe(2);
    });

    it('returns empty set when no dismissed pairs', async () => {
      const { repo, where } = makeRepo();
      where.mockResolvedValue([]);

      const result = await repo.getDismissedPairSet('genre');
      expect(result.size).toBe(0);
    });
  });

  describe('insertInlineDismissedPair', () => {
    it('canonicalizes values alphabetically', async () => {
      const { repo, values } = makeRepo();
      await repo.insertInlineDismissedPair('publisher', 'Zebra', 'Alpha', 'reason', 1);

      const insertValues = values.mock.calls[0]![0];
      expect(insertValues.valueA).toBe('Alpha');
      expect(insertValues.valueB).toBe('Zebra');
    });
  });

  describe('deleteInlineDismissedPairsForValue', () => {
    it('deletes all pairs involving the value', async () => {
      const { repo, db } = makeRepo();
      await repo.deleteInlineDismissedPairsForValue('language', 'English');

      expect(db.delete).toHaveBeenCalled();
    });
  });

  describe('getInlineDismissedPairSet', () => {
    it('returns set with both orderings', async () => {
      const { repo, where } = makeRepo();
      where.mockResolvedValue([{ id: 1, valueA: 'A', valueB: 'B', reason: null, dismissedAt: new Date() }]);

      const result = await repo.getInlineDismissedPairSet('publisher');

      expect(result.has('A:B')).toBe(true);
      expect(result.has('B:A')).toBe(true);
    });
  });
});
