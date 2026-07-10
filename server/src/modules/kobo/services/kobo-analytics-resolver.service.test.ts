import { KoboAnalyticsResolverService } from './kobo-analytics-resolver.service';

function makeSelectChain(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy, limit });
  const innerJoin = vi.fn().mockReturnValue({ where });
  const from = vi.fn().mockReturnValue({ innerJoin, where });
  return { from, where, orderBy, limit };
}

function collectNumericValues(value: unknown, seen = new Set<unknown>()): number[] {
  if (typeof value === 'number') return [value];
  if (!value || typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);
  return Object.values(value as Record<string, unknown>).flatMap((child) => collectNumericValues(child, seen));
}

function makeDb() {
  return {
    query: {
      books: { findFirst: vi.fn() },
      bookFiles: { findFirst: vi.fn() },
    },
    select: vi.fn(),
  };
}

describe('KoboAnalyticsResolverService', () => {
  const bookAccessService = { assertBookAccessible: vi.fn() };

  function makeService(db: ReturnType<typeof makeDb>) {
    return new KoboAnalyticsResolverService(db as never, bookAccessService as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    bookAccessService.assertBookAccessible.mockResolvedValue(undefined);
  });

  it('skips when the user cannot access the book', async () => {
    bookAccessService.assertBookAccessible.mockRejectedValue(new Error('forbidden'));
    const db = makeDb();

    await expect(makeService(db).resolveBookFileId(1, 3, 9)).resolves.toEqual({
      kind: 'skipped',
      reason: 'book_not_accessible',
    });
  });

  it('resolves via snapshot file hash when exactly one epub matches', async () => {
    const db = makeDb();
    db.query.books.findFirst.mockResolvedValue({ id: 9, primaryFileId: 50 });
    const snapChain = makeSelectChain([{ fileHash: 'abc123' }]);
    const hashChain = {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 42 }]),
      }),
    };
    db.select.mockReturnValueOnce(snapChain).mockReturnValueOnce(hashChain);

    await expect(makeService(db).resolveBookFileId(101, 303, 909)).resolves.toEqual({
      kind: 'resolved',
      bookFileId: 42,
    });
    expect(collectNumericValues(snapChain.where.mock.calls[0]![0])).toEqual(expect.arrayContaining([101, 303, 909]));
  });

  it('prefers the current primary when multiple files share the snapshot hash', async () => {
    const db = makeDb();
    db.query.books.findFirst.mockResolvedValue({ id: 9, primaryFileId: 51 });
    const snapChain = makeSelectChain([{ fileHash: 'abc123' }]);
    const hashChain = {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 50 }, { id: 51 }]),
      }),
    };
    db.select.mockReturnValueOnce(snapChain).mockReturnValueOnce(hashChain);

    await expect(makeService(db).resolveBookFileId(1, 3, 9)).resolves.toEqual({
      kind: 'resolved',
      bookFileId: 51,
    });
  });

  it('falls back to the lowest file id when multiple hash matches and primary is not among them', async () => {
    const db = makeDb();
    db.query.books.findFirst.mockResolvedValue({ id: 9, primaryFileId: 99 });
    const snapChain = makeSelectChain([{ fileHash: 'abc123' }]);
    const hashChain = {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 55 }, { id: 44 }]),
      }),
    };
    db.select.mockReturnValueOnce(snapChain).mockReturnValueOnce(hashChain);

    await expect(makeService(db).resolveBookFileId(1, 3, 9)).resolves.toEqual({
      kind: 'resolved',
      bookFileId: 44,
    });
  });

  it('falls back to the primary epub when snapshot hash is missing', async () => {
    const db = makeDb();
    db.query.books.findFirst.mockResolvedValue({ id: 9, primaryFileId: 50 });
    const snapChain = makeSelectChain([]);
    db.select.mockReturnValueOnce(snapChain);
    db.query.bookFiles.findFirst.mockResolvedValue({ id: 50 });

    await expect(makeService(db).resolveBookFileId(1, 3, 9)).resolves.toEqual({
      kind: 'resolved',
      bookFileId: 50,
    });
  });

  it('falls back to primary when hash matches no files', async () => {
    const db = makeDb();
    db.query.books.findFirst.mockResolvedValue({ id: 9, primaryFileId: 50 });
    const snapChain = makeSelectChain([{ fileHash: 'stale' }]);
    const hashChain = {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    };
    db.select.mockReturnValueOnce(snapChain).mockReturnValueOnce(hashChain);
    db.query.bookFiles.findFirst.mockResolvedValue({ id: 50 });

    await expect(makeService(db).resolveBookFileId(1, 3, 9)).resolves.toEqual({
      kind: 'resolved',
      bookFileId: 50,
    });
  });

  it('skips when there is no epub primary file', async () => {
    const db = makeDb();
    db.query.books.findFirst.mockResolvedValue({ id: 9, primaryFileId: null });
    const snapChain = makeSelectChain([]);
    db.select.mockReturnValueOnce(snapChain);

    await expect(makeService(db).resolveBookFileId(1, 3, 9)).resolves.toEqual({
      kind: 'skipped',
      reason: 'no_epub_file',
    });
  });

  it('skips when the book row does not exist', async () => {
    const db = makeDb();
    db.query.books.findFirst.mockResolvedValue(null);

    await expect(makeService(db).resolveBookFileId(1, 3, 9)).resolves.toEqual({
      kind: 'skipped',
      reason: 'book_not_found',
    });
  });

  it('skips when primary file id is set but no epub file exists', async () => {
    const db = makeDb();
    db.query.books.findFirst.mockResolvedValue({ id: 9, primaryFileId: 50 });
    const snapChain = makeSelectChain([]);
    db.select.mockReturnValueOnce(snapChain);
    db.query.bookFiles.findFirst.mockResolvedValue(null);

    await expect(makeService(db).resolveBookFileId(1, 3, 9)).resolves.toEqual({
      kind: 'skipped',
      reason: 'no_epub_file',
    });
  });
});
