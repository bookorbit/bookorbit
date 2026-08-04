import { ServerFontRepository } from './server-font.repository';

describe('ServerFontRepository', () => {
  const mockQuery = {
    serverFonts: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(undefined),
    },
  };

  const mockDb = {
    query: mockQuery,
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  let repo: ServerFontRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.serverFonts.findMany.mockResolvedValue([]);
    mockQuery.serverFonts.findFirst.mockResolvedValue(undefined);

    mockDb.select.mockReturnValue({ from: vi.fn().mockResolvedValue([{ count: 5 }]) });
    mockDb.insert.mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 1 }]) }) });
    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 1, familyName: 'Updated' }]),
        }),
      }),
    });
    mockDb.delete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });

    repo = new ServerFontRepository(mockDb as never);
  });

  describe('findAll', () => {
    it('lists fonts ordered by family, then weight, then style', async () => {
      await repo.findAll();

      const call = mockQuery.serverFonts.findMany.mock.calls[0][0] as { orderBy: unknown[] };
      expect(call.orderBy).toHaveLength(3);
    });

    it('returns the rows it was given', async () => {
      mockQuery.serverFonts.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);

      await expect(repo.findAll()).resolves.toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('is not scoped to any user', async () => {
      await repo.findAll();

      expect(mockQuery.serverFonts.findMany.mock.calls[0][0]).not.toHaveProperty('where');
    });
  });

  describe('findById', () => {
    it('returns undefined when the font does not exist', async () => {
      await expect(repo.findById(404)).resolves.toBeUndefined();
    });

    it('returns the row when it exists', async () => {
      mockQuery.serverFonts.findFirst.mockResolvedValue({ id: 3 });

      await expect(repo.findById(3)).resolves.toEqual({ id: 3 });
    });
  });

  describe('findByHash', () => {
    it('returns undefined when no font matches the hash', async () => {
      await expect(repo.findByHash('nope')).resolves.toBeUndefined();
    });

    it('returns the matching row', async () => {
      mockQuery.serverFonts.findFirst.mockResolvedValue({ id: 9, fileHash: 'abc' });

      await expect(repo.findByHash('abc')).resolves.toEqual({ id: 9, fileHash: 'abc' });
    });
  });

  describe('countAll', () => {
    it('returns the aggregate count', async () => {
      await expect(repo.countAll()).resolves.toBe(5);
    });

    it('returns 0 when the aggregate comes back empty', async () => {
      mockDb.select.mockReturnValue({ from: vi.fn().mockResolvedValue([]) });

      await expect(repo.countAll()).resolves.toBe(0);
    });
  });

  describe('create', () => {
    it('returns the inserted row', async () => {
      const result = await repo.create({
        familyName: 'OpenDyslexic',
        originalFileName: 'OpenDyslexic.otf',
        storedFileName: 'uuid.otf',
        format: 'otf',
        fileSize: 100,
        fileHash: 'hash',
      });

      expect(result).toEqual({ id: 1 });
    });
  });

  describe('update', () => {
    it('returns the updated row', async () => {
      await expect(repo.update(1, { familyName: 'Updated' })).resolves.toEqual({ id: 1, familyName: 'Updated' });
    });

    it('returns undefined when no row matched', async () => {
      mockDb.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
        }),
      });

      await expect(repo.update(404, { familyName: 'Updated' })).resolves.toBeUndefined();
    });
  });

  describe('delete', () => {
    it('issues the delete', async () => {
      await repo.delete(1);

      expect(mockDb.delete).toHaveBeenCalledTimes(1);
    });
  });
});
