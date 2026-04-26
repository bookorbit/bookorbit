import { MagicLinkRepository } from './magic-link.repository';

describe('MagicLinkRepository', () => {
  function makeDb() {
    const db: Record<string, unknown> = {
      query: {
        magicAccessTokens: { findFirst: vi.fn() },
      },
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 1, label: 'Test', expiresAt: null, rawToken: 'raw' }]),
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ total: 3 }]),
      innerJoin: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    };
    return db as never;
  }

  it('create inserts and returns the new row', async () => {
    const db = makeDb();
    const repo = new MagicLinkRepository(db);

    const result = await repo.create({ userId: 1, createdBy: 2, label: 'Test' });

    expect(result).toEqual({ id: 1, label: 'Test', expiresAt: null, rawToken: 'raw' });
    expect((db as Record<string, vi.Mock>).insert).toHaveBeenCalled();
  });

  it('findByTokenHash delegates to query', async () => {
    const db = makeDb();
    const repo = new MagicLinkRepository(db);
    (db.query as Record<string, Record<string, vi.Mock>>).magicAccessTokens.findFirst.mockResolvedValue({ id: 1 });

    const result = await repo.findByTokenHash('hash');
    expect(result).toEqual({ id: 1 });
  });

  it('findById delegates to query', async () => {
    const db = makeDb();
    const repo = new MagicLinkRepository(db);
    (db.query as Record<string, Record<string, vi.Mock>>).magicAccessTokens.findFirst.mockResolvedValue({ id: 5 });

    const result = await repo.findById(5);
    expect(result).toEqual({ id: 5 });
  });

  it('findAll joins users and returns rows', async () => {
    const db = makeDb();
    const repo = new MagicLinkRepository(db);

    const result = await repo.findAll();
    expect(result).toEqual([]);
    expect((db as Record<string, vi.Mock>).innerJoin).toHaveBeenCalled();
    expect((db as Record<string, vi.Mock>).leftJoin).toHaveBeenCalled();
  });

  it('countActiveByUserId returns integer count', async () => {
    const db = makeDb();
    const repo = new MagicLinkRepository(db);

    const count = await repo.countActiveByUserId(1);
    expect(count).toBe(3);
  });

  it('hasActiveByUserId returns true when count > 0', async () => {
    const db = makeDb();
    const repo = new MagicLinkRepository(db);

    const result = await repo.hasActiveByUserId(1);
    expect(result).toBe(true);
  });

  it('hasActiveByUserId returns false when count is 0', async () => {
    const db = makeDb();
    (db as Record<string, vi.Mock>).where.mockResolvedValue([{ total: 0 }]);
    const repo = new MagicLinkRepository(db);

    const result = await repo.hasActiveByUserId(1);
    expect(result).toBe(false);
  });

  it('setActive updates and returns the row', async () => {
    const db = makeDb();
    (db as Record<string, vi.Mock>).returning = vi.fn().mockResolvedValue([{ id: 1, userId: 2, isActive: false }]);
    (db as Record<string, vi.Mock>).where = vi.fn().mockReturnThis();
    const repo = new MagicLinkRepository(db);

    const result = await repo.setActive(1, false);
    expect(result).toEqual({ id: 1, userId: 2, isActive: false });
  });

  it('setActive returns null when no row matched', async () => {
    const db = makeDb();
    (db as Record<string, vi.Mock>).returning = vi.fn().mockResolvedValue([]);
    (db as Record<string, vi.Mock>).where = vi.fn().mockReturnThis();
    const repo = new MagicLinkRepository(db);

    const result = await repo.setActive(999, false);
    expect(result).toBeNull();
  });

  it('revoke sets revokedAt and returns the row', async () => {
    const db = makeDb();
    (db as Record<string, vi.Mock>).returning = vi.fn().mockResolvedValue([{ id: 1, userId: 2 }]);
    (db as Record<string, vi.Mock>).where = vi.fn().mockReturnThis();
    const repo = new MagicLinkRepository(db);

    const result = await repo.revoke(1);
    expect(result).toEqual({ id: 1, userId: 2 });
  });

  it('updateUsage increments use_count', async () => {
    const db = makeDb();
    (db as Record<string, vi.Mock>).where = vi.fn().mockResolvedValue(undefined);
    const repo = new MagicLinkRepository(db);

    await repo.updateUsage(1);
    expect((db as Record<string, vi.Mock>).update).toHaveBeenCalled();
    expect((db as Record<string, vi.Mock>).set).toHaveBeenCalled();
  });
});
