import { ScannerRepository } from './scanner.repository';

type QueryKind = 'select' | 'insert' | 'update' | 'delete';

type ChainState = {
  proxy: any;
  mocks: Record<string, vi.Mock>;
};

function makeChain(initialResult: unknown): ChainState {
  let result = initialResult;
  const mocks: Record<string, vi.Mock> = {};
  const proxy = new Proxy(
    {},
    {
      get(_target, key) {
        if (key === 'then') {
          return (onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
            Promise.resolve(result).then(onFulfilled, onRejected);
        }
        if (key === '__setResult') {
          return (next: unknown) => {
            result = next;
          };
        }
        const method = String(key);
        if (!mocks[method]) {
          mocks[method] = vi.fn(() => proxy);
        }
        return mocks[method];
      },
    },
  );

  return { proxy, mocks };
}

function makeDb() {
  const queues: Record<QueryKind, unknown[]> = { select: [], insert: [], update: [], delete: [] };
  const chains: Record<QueryKind, ChainState[]> = { select: [], insert: [], update: [], delete: [] };

  const next = (kind: QueryKind) => {
    const state = makeChain(queues[kind].length > 0 ? queues[kind].shift() : []);
    chains[kind].push(state);
    return state.proxy;
  };

  return {
    queues,
    chains,
    db: {
      select: vi.fn(() => next('select')),
      insert: vi.fn(() => next('insert')),
      update: vi.fn(() => next('update')),
      delete: vi.fn(() => next('delete')),
    },
  };
}

function makeRepo() {
  const fixture = makeDb();
  return { ...fixture, repo: new ScannerRepository(fixture.db as any) };
}

describe('ScannerRepository', () => {
  it('handles scan job lifecycle writes', async () => {
    const { repo, queues, db, chains } = makeRepo();
    queues.insert.push([{ id: 501, libraryId: 3, triggeredBy: 'manual' }]);

    const job = await repo.createScanJob(3, 'manual');
    await repo.completeScanJob(501, { addedCount: 1, updatedCount: 2, missingCount: 3 });
    await repo.failScanJob(501, 'failed');
    await repo.failAllRunningJobs('restart');

    expect(job).toEqual({ id: 501, libraryId: 3, triggeredBy: 'manual' });
    expect(db.update).toHaveBeenCalledTimes(3);
    expect(chains.update[0].mocks.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', addedCount: 1 }));
    expect(chains.update[1].mocks.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', errorMessage: 'failed' }));
    expect(chains.update[2].mocks.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', errorMessage: 'restart' }));
  });

  it('reads library folders/settings and returns null when rows are absent', async () => {
    const { repo, queues } = makeRepo();
    queues.select.push([{ id: 1, path: '/books' }]);
    queues.select.push([{ allowedFormats: ['epub'], formatPriority: ['epub'], excludePatterns: [], organizationMode: 'book_per_folder' }]);
    queues.select.push([]);
    queues.select.push([{ path: '/books' }]);
    queues.select.push([]);

    await expect(repo.findLibraryFolders(1)).resolves.toEqual([{ id: 1, path: '/books' }]);
    await expect(repo.findLibrarySettings(1)).resolves.toEqual({
      allowedFormats: ['epub'],
      formatPriority: ['epub'],
      excludePatterns: [],
      organizationMode: 'book_per_folder',
    });
    await expect(repo.findLibrarySettings(2)).resolves.toBeNull();
    await expect(repo.findLibraryFolderPath(1)).resolves.toBe('/books');
    await expect(repo.findLibraryFolderPath(2)).resolves.toBeNull();
  });

  it('creates and updates books, including primary file reassignment and missing state', async () => {
    const { repo, queues, db, chains } = makeRepo();
    queues.insert.push([{ id: 11, libraryId: 9, folderPath: '/books/Book', status: 'present' }]);
    queues.insert.push([]);

    const created = await repo.createBook({ libraryId: 9, libraryFolderId: 3, folderPath: '/books/Book', status: 'present' } as any);
    await repo.updateBookStatus(11, 'missing');
    await repo.updateBookPrimaryFile(11, 77);
    await repo.updateBookPrimaryFile(11, null);
    await repo.markBooksAsMissing([11, 12]);

    expect(created).toEqual({ id: 11, libraryId: 9, folderPath: '/books/Book', status: 'present' });
    expect(db.insert).toHaveBeenCalledTimes(2);
    expect(chains.insert[0].mocks.onConflictDoUpdate).toHaveBeenCalledTimes(1);
    expect(chains.insert[1].mocks.onConflictDoNothing).toHaveBeenCalledTimes(1);
    expect(db.update).toHaveBeenCalledTimes(4);
  });

  it('queries book/file lookups with optional scope variants', async () => {
    const { repo, queues } = makeRepo();
    queues.select.push([{ id: 1, status: 'present', folderPath: '/books/A' }]);
    queues.select.push([{ bookId: 1, absolutePath: '/books/A/book.epub', format: 'epub' }]);
    queues.select.push([{ id: 7, absolutePath: '/books/A/book.epub' }]);
    queues.select.push([{ id: 90, bookId: 1, absolutePath: '/books/A/book.epub', ino: 999, sizeBytes: 10, mtime: new Date(), hash: 'x' }]);
    queues.select.push([{ id: 15, bookId: 1, libraryId: 4, primaryFileId: 90 }]);
    queues.select.push([{ id: 16, bookId: 2, libraryId: 5, primaryFileId: 91 }]);
    queues.select.push([{ id: 3, folderPath: '/books/A' }]);
    queues.select.push([{ id: 4, folderPath: '/books/B' }]);
    queues.select.push([{ id: 8, folderPath: '/books/A', status: 'missing' }]);
    queues.select.push([]);
    queues.select.push([{ id: 11, folderPath: '/books/A', status: 'missing' }]);
    queues.select.push([{ id: 12, folderPath: '/books/B', status: 'missing' }]);

    await expect(repo.findBooksByLibraryFolder(4)).resolves.toEqual([{ id: 1, status: 'present', folderPath: '/books/A' }]);
    await expect(repo.findPrimaryBookFilesByLibrary(4)).resolves.toEqual([{ bookId: 1, absolutePath: '/books/A/book.epub', format: 'epub' }]);
    await expect(repo.findPrimaryBookFilesByBookId(1)).resolves.toEqual([{ id: 7, absolutePath: '/books/A/book.epub' }]);
    await expect(repo.findBookFilesByLibraryFolder(4)).resolves.toEqual([
      { id: 90, bookId: 1, absolutePath: '/books/A/book.epub', ino: 999, sizeBytes: 10, mtime: expect.any(Date), hash: 'x' },
    ]);
    await expect(repo.findBookFileByAbsolutePath('/books/A/book.epub')).resolves.toEqual({ id: 15, bookId: 1, libraryId: 4, primaryFileId: 90 });
    await expect(repo.findBookFileByAbsolutePath('/books/B/book.epub', 5)).resolves.toEqual({ id: 16, bookId: 2, libraryId: 5, primaryFileId: 91 });
    await expect(repo.findBooksByFolderPath('/books/A')).resolves.toEqual([{ id: 3, folderPath: '/books/A' }]);
    await expect(repo.findBooksByFolderPath('/books/B', 5)).resolves.toEqual([{ id: 4, folderPath: '/books/B' }]);
    await expect(repo.findMissingBookByFolderPath('/books/A')).resolves.toEqual({ id: 8, folderPath: '/books/A', status: 'missing' });
    await expect(repo.findMissingBookByFolderPath('/books/B', 5)).resolves.toBeNull();
    await expect(repo.findMissingBooksByFolderPath('/books/A')).resolves.toEqual([{ id: 11, folderPath: '/books/A', status: 'missing' }]);
    await expect(repo.findMissingBooksByFolderPath('/books/B', 5)).resolves.toEqual([{ id: 12, folderPath: '/books/B', status: 'missing' }]);
  });

  it('creates and updates book files and supports hash lookup', async () => {
    const { repo, queues, chains, db } = makeRepo();
    queues.select.push([{ id: 50, hash: 'abc123' }]);
    queues.insert.push([{ id: 300, absolutePath: '/books/C/book.epub', hash: 'abc123' }]);
    queues.update.push([{ id: 300, absolutePath: '/books/C/book.epub', hash: 'abc123', format: 'epub' }]);

    await expect(repo.findBookFileByHash('abc123', 9)).resolves.toEqual({ id: 50, hash: 'abc123' });
    await expect(repo.createBookFile({ bookId: 1, libraryFolderId: 9, absolutePath: '/books/C/book.epub' } as any)).resolves.toEqual({
      id: 300,
      absolutePath: '/books/C/book.epub',
      hash: 'abc123',
    });
    await expect(repo.updateBookFile(300, { format: 'epub' } as any)).resolves.toEqual({
      id: 300,
      absolutePath: '/books/C/book.epub',
      hash: 'abc123',
      format: 'epub',
    });
    expect(chains.update[0].mocks.set).toHaveBeenCalledWith(expect.objectContaining({ format: 'epub' }));
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it('handles missing/present transitions and moving books across libraries', async () => {
    const { repo, queues, db } = makeRepo();
    queues.select.push([
      { id: 1, status: 'missing' },
      { id: 2, status: 'missing' },
    ]);
    queues.update.push([]);
    queues.update.push([{ id: 99, libraryId: 7, libraryFolderId: 8, folderPath: '/dest/Book', status: 'present' }]);
    queues.update.push([]);

    await expect(repo.findMissingBooksForLibraries([7, 8])).resolves.toEqual([
      { id: 1, status: 'missing' },
      { id: 2, status: 'missing' },
    ]);
    await repo.markBooksAsPresent([1, 2]);
    await expect(repo.moveBookToLibrary(99, 7, 8, '/dest/Book')).resolves.toEqual({
      id: 99,
      libraryId: 7,
      libraryFolderId: 8,
      folderPath: '/dest/Book',
      status: 'present',
    });
    await expect(repo.moveBookToLibrary(100, 7, 8, '/dest/Missing')).resolves.toBeNull();

    expect(db.update).toHaveBeenCalledTimes(3);
  });

  it('supports context lookups by inode/hash and file deletion', async () => {
    const { repo, queues, db } = makeRepo();
    queues.select.push([{ id: 1, bookId: 1 }]);
    queues.select.push([{ id: 2, bookId: 2 }]);
    queues.select.push([{ id: 10, file: { id: 10, ino: 123 } }]);
    queues.select.push([{ id: 11, file: { id: 11, ino: 124 } }]);
    queues.select.push([{ id: 12, file: { id: 12, hash: 'x' } }]);
    queues.select.push([{ id: 13, file: { id: 13, hash: 'y' } }]);
    queues.select.push([{ id: 14, file: { id: 14, hash: 'z' } }]);
    queues.select.push([{ id: 15, file: { id: 15, hash: 'zz' } }]);
    queues.select.push([{ id: 20, bookId: 4, absolutePath: '/books/D/book.epub' }]);
    queues.select.push([{ id: 21, bookId: 5, absolutePath: '/books/E/book.epub' }]);

    await expect(repo.findBookFilesByBookId(1)).resolves.toEqual([{ id: 1, bookId: 1 }]);
    await expect(repo.findBookFilesByBookIds([1, 2])).resolves.toEqual([{ id: 2, bookId: 2 }]);
    await expect(repo.findBookFileWithContextByIno(123)).resolves.toEqual({ id: 10, file: { id: 10, ino: 123 } });
    await expect(repo.findBookFileWithContextByIno(124, 4)).resolves.toEqual({ id: 11, file: { id: 11, ino: 124 } });
    await expect(repo.findMissingBookFileWithContextByIno(125)).resolves.toEqual({ id: 12, file: { id: 12, hash: 'x' } });
    await expect(repo.findBookFileWithContextByHash('abc')).resolves.toEqual({ id: 13, file: { id: 13, hash: 'y' } });
    await expect(repo.findMissingBookFileWithContextByHash('def')).resolves.toEqual({ id: 14, file: { id: 14, hash: 'z' } });
    await expect(repo.findBookFileByAbsolutePath('/books/D/book.epub', 4)).resolves.toEqual({
      id: 15,
      file: { id: 15, hash: 'zz' },
    });
    await expect(repo.findBookFilesByBookId(4)).resolves.toEqual([{ id: 20, bookId: 4, absolutePath: '/books/D/book.epub' }]);
    await expect(repo.findBookFilesByBookIds([4, 5])).resolves.toEqual([{ id: 21, bookId: 5, absolutePath: '/books/E/book.epub' }]);
    await repo.deleteBookFile(21);
    await repo.updateBookFolderPath(4, '/books/D');

    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it('returns empty card data for empty input and aggregates card data for requested books', async () => {
    const { repo, queues } = makeRepo();
    await expect(repo.findBookCardData([])).resolves.toEqual({ rows: [], authorRows: [], fileRows: [], genreRows: [] });

    queues.select.push([{ id: 1, title: 'Book One' }]);
    queues.select.push([{ bookId: 1, name: 'Author One' }]);
    queues.select.push([{ bookId: 1, id: 10, format: 'epub', role: 'content' }]);
    queues.select.push([{ bookId: 1, name: 'Fiction' }]);

    await expect(repo.findBookCardData([1])).resolves.toEqual({
      rows: [{ id: 1, title: 'Book One' }],
      authorRows: [{ bookId: 1, name: 'Author One' }],
      fileRows: [{ bookId: 1, id: 10, format: 'epub', role: 'content' }],
      genreRows: [{ bookId: 1, name: 'Fiction' }],
    });
  });
});
