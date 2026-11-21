vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  getTableColumns: vi.fn(() => ({})),
  inArray: vi.fn((left: unknown, right: unknown[]) => ({ op: 'inArray', left, right })),
  or: vi.fn((...clauses: unknown[]) => ({ op: 'or', clauses })),
  isNotNull: vi.fn((value: unknown) => ({ op: 'isNotNull', value })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ op: 'sql', text: strings.join(''), values })),
}));

vi.mock('../../db/reading-attempt-retention', () => ({ retainFinishedReads: vi.fn() }));
vi.mock('../../db/kobo-entitlement-tombstones', () => ({ writeKoboTombstones: vi.fn() }));

import { writeKoboTombstones } from '../../db/kobo-entitlement-tombstones';
import { retainFinishedReads } from '../../db/reading-attempt-retention';
import { bookLinkGroups, bookLinks, books, libraries, libraryFolders } from '../../db/schema';
import { LIBRARY_BOOK_STATUS_PRESENT } from './library.constants';
import { LibraryRepository } from './library.repository';

describe('LibraryRepository', () => {
  const txUpdateWhere = vi.fn();
  const txUpdateSet = vi.fn();
  const txUpdate = vi.fn(() => ({ set: txUpdateSet }));
  const txExecute = vi.fn();
  const txDeleteWhere = vi.fn();
  const txDelete = vi.fn(() => ({ where: txDeleteWhere }));
  const tx = {
    update: txUpdate,
    execute: txExecute,
    delete: txDelete,
  };

  const db = {
    update: vi.fn(),
    select: vi.fn(),
    transaction: vi.fn(),
    query: {
      userLibraryAccess: {
        findFirst: vi.fn(),
      },
    },
  };

  let repo: LibraryRepository;

  beforeEach(() => {
    vi.resetAllMocks();
    repo = new LibraryRepository(db as any);

    db.transaction.mockImplementation(async (callback: (transaction: typeof tx) => Promise<void>) => callback(tx));
    txUpdate.mockImplementation(() => ({ set: txUpdateSet }));
    txUpdateSet.mockReturnValue({ where: txUpdateWhere });
    txUpdateWhere.mockResolvedValue(undefined);
    txExecute.mockResolvedValue(undefined);
    txDelete.mockImplementation(() => ({ where: txDeleteWhere }));
    txDeleteWhere.mockResolvedValue(undefined);
  });

  it('delete drops the link groups the library leaves with fewer than two members, in the same transaction', async () => {
    await repo.delete(42);

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(retainFinishedReads).toHaveBeenCalledWith(tx, { op: 'eq', left: books.libraryId, right: 42 });
    expect(writeKoboTombstones).toHaveBeenCalledWith(tx, { op: 'eq', left: books.libraryId, right: 42 });
    expect(txExecute).toHaveBeenCalledTimes(1);
    const statement = txExecute.mock.calls[0]![0] as { text: string; values: unknown[] };
    expect(statement.text).toMatch(/^\s*delete from /);
    expect(statement.text).toContain(') < 2');
    expect(statement.values).toEqual([bookLinkGroups, bookLinks, books, 42, bookLinks, books, 42]);
    expect(txDelete).toHaveBeenCalledWith(libraries);
    expect(txDeleteWhere).toHaveBeenCalledWith({ op: 'eq', left: libraries.id, right: 42 });
    // Counted while the books are still there: the library delete cascades them away.
    expect(txExecute.mock.invocationCallOrder[0]).toBeLessThan(txDelete.mock.invocationCallOrder[0]!);
  });

  it('updateDisplayOrders updates each library order entry in one transaction', async () => {
    await repo.updateDisplayOrders([
      { id: 1, displayOrder: 5 },
      { id: 2, displayOrder: 6 },
    ]);

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(txUpdate).toHaveBeenCalledTimes(2);
    expect(txUpdateSet).toHaveBeenNthCalledWith(1, { displayOrder: 5 });
    expect(txUpdateSet).toHaveBeenNthCalledWith(2, { displayOrder: 6 });
  });

  it('findAll counts only present books while retaining empty libraries', async () => {
    const orderBy = vi.fn().mockResolvedValue([]);
    const groupBy = vi.fn().mockReturnValue({ orderBy });
    const leftJoin = vi.fn().mockReturnValue({ groupBy });
    const from = vi.fn().mockReturnValue({ leftJoin });
    db.select.mockReturnValue({ from });

    await repo.findAll();

    expect(leftJoin).toHaveBeenCalledWith(books, {
      op: 'and',
      clauses: [
        { op: 'eq', left: books.libraryId, right: libraries.id },
        { op: 'eq', left: books.status, right: LIBRARY_BOOK_STATUS_PRESENT },
      ],
    });
  });

  it('findAllForUser includes organization and automation settings and counts only present books', async () => {
    const orderBy = vi.fn().mockResolvedValue([]);
    const groupBy = vi.fn().mockReturnValue({ orderBy });
    const leftJoin = vi.fn().mockReturnValue({ groupBy });
    const innerJoin = vi.fn().mockReturnValue({ leftJoin });
    const from = vi.fn().mockReturnValue({ innerJoin });
    db.select.mockReturnValue({ from });

    await repo.findAllForUser(42);

    expect(db.select).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationMode: libraries.organizationMode,
        autoScanCronExpression: libraries.autoScanCronExpression,
        watch: libraries.watch,
        fileWriteEnabled: libraries.fileWriteEnabled,
        fileRenameEnabled: libraries.fileRenameEnabled,
      }),
    );
    expect(leftJoin).toHaveBeenCalledWith(books, {
      op: 'and',
      clauses: [
        { op: 'eq', left: books.libraryId, right: libraries.id },
        { op: 'eq', left: books.status, right: LIBRARY_BOOK_STATUS_PRESENT },
      ],
    });
    expect(orderBy).toHaveBeenCalledWith(libraries.displayOrder, libraries.name);
  });

  it('findAutoScanSchedules selects only libraries with a configured expression', async () => {
    const orderBy = vi.fn().mockResolvedValue([{ id: 4, autoScanCronExpression: '0 4 * * *' }]);
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    db.select.mockReturnValue({ from });

    await expect(repo.findAutoScanSchedules()).resolves.toEqual([{ id: 4, autoScanCronExpression: '0 4 * * *' }]);

    expect(db.select).toHaveBeenCalledWith({
      id: libraries.id,
      autoScanCronExpression: libraries.autoScanCronExpression,
    });
    expect(where).toHaveBeenCalledWith({ op: 'isNotNull', value: libraries.autoScanCronExpression });
    expect(orderBy).toHaveBeenCalledWith(libraries.id);
  });

  it('orders folders by creation time with an id tie-breaker', async () => {
    const byLibraryOrderBy = vi.fn().mockResolvedValue([]);
    const byLibraryWhere = vi.fn().mockReturnValue({ orderBy: byLibraryOrderBy });
    const byLibraryFrom = vi.fn().mockReturnValue({ where: byLibraryWhere });
    db.select.mockReturnValueOnce({ from: byLibraryFrom });

    await repo.findFoldersByLibrary(7);

    expect(byLibraryOrderBy).toHaveBeenCalledWith(libraryFolders.createdAt, libraryFolders.id);

    const allOrderBy = vi.fn().mockResolvedValue([]);
    const allFrom = vi.fn().mockReturnValue({ orderBy: allOrderBy });
    db.select.mockReturnValueOnce({ from: allFrom });

    await repo.findAllFolders();

    expect(allOrderBy).toHaveBeenCalledWith(libraryFolders.libraryId, libraryFolders.createdAt, libraryFolders.id);

    const scopedOrderBy = vi.fn().mockResolvedValue([]);
    const scopedWhere = vi.fn().mockReturnValue({ orderBy: scopedOrderBy });
    const scopedFrom = vi.fn().mockReturnValue({ where: scopedWhere });
    db.select.mockReturnValueOnce({ from: scopedFrom });

    await repo.findFoldersByLibraryIds([7, 8]);

    expect(scopedOrderBy).toHaveBeenCalledWith(libraryFolders.libraryId, libraryFolders.createdAt, libraryFolders.id);

    const pathsOrderBy = vi.fn().mockResolvedValue([]);
    const pathsInnerJoin = vi.fn().mockReturnValue({ orderBy: pathsOrderBy });
    const pathsFrom = vi.fn().mockReturnValue({ innerJoin: pathsInnerJoin });
    db.select.mockReturnValueOnce({ from: pathsFrom });

    await repo.findAllFolderPaths();

    expect(pathsOrderBy).toHaveBeenCalledWith(libraries.displayOrder, libraries.name, libraryFolders.createdAt, libraryFolders.id);
  });

  function mockStatsRows(counts: unknown[], formats: unknown[], sizes: unknown[]) {
    const grouped = (rows: unknown[]) => ({ where: vi.fn().mockReturnValue({ groupBy: vi.fn().mockResolvedValue(rows) }) });
    db.select.mockReturnValueOnce({ from: vi.fn().mockReturnValue(grouped(counts)) });
    for (const rows of [formats, sizes]) {
      db.select.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ innerJoin: vi.fn().mockReturnValue(grouped(rows)) }) });
    }
  }

  it('getStatsForLibraries reports primary and held formats for each requested library in three queries', async () => {
    mockStatsRows(
      [
        { libraryId: 1, count: 3 },
        { libraryId: 2, count: 1 },
      ],
      [
        { libraryId: 1, format: 'epub', primaryCount: 2, heldCount: 2 },
        { libraryId: 1, format: 'kepub', primaryCount: 0, heldCount: 2 },
        { libraryId: 1, format: 'pdf', primaryCount: 1, heldCount: 1 },
        { libraryId: 2, format: 'mp3', primaryCount: 1, heldCount: 1 },
      ],
      [
        { libraryId: 1, totalSize: '3700' },
        { libraryId: 2, totalSize: '406000000' },
      ],
    );
    const stats = await repo.getStatsForLibraries([1, 2, 3]);

    expect(db.select).toHaveBeenCalledTimes(3);
    expect(stats.get(1)).toEqual({
      totalBooks: 3,
      totalSizeBytes: 3700,
      formatCounts: { epub: 2, pdf: 1 },
      heldFormatCounts: { epub: 2, kepub: 2, pdf: 1 },
    });
    expect(stats.get(2)).toEqual({ totalBooks: 1, totalSizeBytes: 406_000_000, formatCounts: { mp3: 1 }, heldFormatCounts: { mp3: 1 } });
    expect(stats.get(3)).toEqual({ totalBooks: 0, totalSizeBytes: 0, formatCounts: {}, heldFormatCounts: {} });
  });

  it('getStatsForLibraries issues no query for an empty id list', async () => {
    await expect(repo.getStatsForLibraries([])).resolves.toEqual(new Map());
    expect(db.select).not.toHaveBeenCalled();
  });

  it('getStats throws when totalSizeBytes exceeds safe integer range', async () => {
    mockStatsRows([{ libraryId: 9, count: 1 }], [], [{ libraryId: 9, totalSize: '9007199254740992' }]);
    await expect(repo.getStats(9)).rejects.toThrow('totalSizeBytes exceeds Number.MAX_SAFE_INTEGER');
  });
});
