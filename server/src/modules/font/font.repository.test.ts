import { FontRepository } from './font.repository';

describe('FontRepository', () => {
  const mockQuery = {
    userFonts: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(undefined),
    },
  };

  const mockDb = {
    query: mockQuery,
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([{ count: 5 }]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: 1 }]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  };

  let repo: FontRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset chain to allow both select and insert/update/delete patterns
    mockDb.select.mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ count: 5 }]) }) });
    mockDb.insert.mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 1 }]) }) });
    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 1, familyName: 'Updated' }]),
        }),
      }),
    });
    mockDb.delete.mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 1 }]),
      }),
    });

    repo = new FontRepository(mockDb as never);
  });

  describe('findAllByUser', () => {
    it('queries fonts by user id', async () => {
      await repo.findAllByUser(42);
      expect(mockQuery.userFonts.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.anything() }));
    });
  });

  describe('findById', () => {
    it('queries a single font by id', async () => {
      await repo.findById(1);
      expect(mockQuery.userFonts.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.anything() }));
    });
  });

  describe('findByUserAndHash', () => {
    it('queries by user and file hash', async () => {
      await repo.findByUserAndHash(42, 'abc123');
      expect(mockQuery.userFonts.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.anything() }));
    });
  });

  describe('countByUser', () => {
    it('returns font count for user', async () => {
      const result = await repo.countByUser(42);
      expect(result).toBe(5);
    });
  });

  describe('create', () => {
    it('inserts a new font and returns it', async () => {
      const result = await repo.create({
        userId: 1,
        familyName: 'Test',
        originalFileName: 'test.ttf',
        storedFileName: 'uuid.ttf',
        format: 'ttf',
        weight: 400,
        style: 'normal',
        fileSize: 1000,
        fileHash: 'hash',
      });
      expect(result).toEqual({ id: 1 });
    });
  });

  describe('update', () => {
    it('updates font and returns the updated row', async () => {
      const result = await repo.update(1, { familyName: 'Updated' });
      expect(result).toEqual({ id: 1, familyName: 'Updated' });
    });
  });

  describe('delete', () => {
    it('deletes a font by id', async () => {
      await repo.delete(1);
      expect(mockDb.delete).toHaveBeenCalled();
    });
  });

  describe('deleteAllByUser', () => {
    it('deletes all fonts for a user', async () => {
      const result = await repo.deleteAllByUser(42);
      expect(result).toEqual([{ id: 1 }]);
    });
  });
});
