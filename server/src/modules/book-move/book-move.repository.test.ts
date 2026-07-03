import { BookMoveRepository } from './book-move.repository';

describe('BookMoveRepository', () => {
  function chain<T>(result: T) {
    return {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(result),
    };
  }

  function orderedChain<T>(result: T) {
    return {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue(result),
    };
  }

  it('findBookForMove maps the book row and its files', async () => {
    const bookRow = {
      id: 5,
      libraryId: 1,
      libraryFolderId: 2,
      libraryFolderPath: '/src-lib',
      folderPath: '/src-lib/Frank Herbert/Dune',
      status: 'present',
    };
    const fileRows = [
      { id: 10, absolutePath: '/src-lib/Frank Herbert/Dune/Dune.epub', relPath: 'Frank Herbert/Dune/Dune.epub', format: 'epub', role: 'primary' },
    ];
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(chain([bookRow]))
        .mockReturnValueOnce(orderedChain(fileRows)),
    };

    const repo = new BookMoveRepository(db as never);

    await expect(repo.findBookForMove(5)).resolves.toEqual({ ...bookRow, files: fileRows });
  });

  it('findBookForMove returns null for unknown books', async () => {
    const db = { select: vi.fn().mockReturnValueOnce(chain([])) };

    const repo = new BookMoveRepository(db as never);

    await expect(repo.findBookForMove(404)).resolves.toBeNull();
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('findLibrary returns the library row or null', async () => {
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(chain([{ id: 3, allowedFormats: ['epub'] }]))
        .mockReturnValueOnce(chain([])),
    };

    const repo = new BookMoveRepository(db as never);

    await expect(repo.findLibrary(3)).resolves.toEqual({ id: 3, allowedFormats: ['epub'] });
    await expect(repo.findLibrary(999)).resolves.toBeNull();
  });

  it('findFolder returns the folder row or null', async () => {
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(chain([{ id: 9, libraryId: 3, path: '/dst-lib' }]))
        .mockReturnValueOnce(chain([])),
    };

    const repo = new BookMoveRepository(db as never);

    await expect(repo.findFolder(9)).resolves.toEqual({ id: 9, libraryId: 3, path: '/dst-lib' });
    await expect(repo.findFolder(999)).resolves.toBeNull();
  });

  it('findFoldersByLibrary lists all folders of a library', async () => {
    const folders = [
      { id: 9, libraryId: 3, path: '/dst-lib' },
      { id: 12, libraryId: 3, path: '/dst-lib-2' },
    ];
    const db = { select: vi.fn().mockReturnValueOnce(orderedChain(folders)) };

    const repo = new BookMoveRepository(db as never);

    await expect(repo.findFoldersByLibrary(3)).resolves.toEqual(folders);
  });

  it('findExistingPaths maps owning book ids by absolute path and skips the query for empty input', async () => {
    const db = {
      select: vi.fn().mockReturnValueOnce(chain([{ absolutePath: '/dst-lib/Dune.epub', bookId: 77 }])),
    };

    const repo = new BookMoveRepository(db as never);

    await expect(repo.findExistingPaths(['/dst-lib/Dune.epub', '/dst-lib/other.epub'])).resolves.toEqual(new Map([['/dst-lib/Dune.epub', 77]]));
    await expect(repo.findExistingPaths([])).resolves.toEqual(new Map());
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('applyMove updates the book row before the files so the folder-consistency FK can cascade', async () => {
    const setCalls: unknown[] = [];
    const tx = {
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn().mockImplementation((values: unknown) => {
          setCalls.push(values);
          return { where: vi.fn().mockResolvedValue(undefined) };
        }),
      })),
    };
    const db = {
      transaction: vi.fn().mockImplementation(async (callback: (value: unknown) => Promise<unknown>) => callback(tx)),
    };

    const repo = new BookMoveRepository(db as never);

    await repo.applyMove(5, { libraryId: 3, libraryFolderId: 9, folderPath: '/dst-lib/Frank Herbert/Dune' }, [
      { id: 10, absolutePath: '/dst-lib/Frank Herbert/Dune/Dune.epub', relPath: 'Frank Herbert/Dune/Dune.epub' },
      { id: 11, absolutePath: '/dst-lib/Frank Herbert/Dune/cover.jpg', relPath: 'Frank Herbert/Dune/cover.jpg' },
    ]);

    expect(db.transaction).toHaveBeenCalledTimes(1);
    // The books row must be updated first: book_files_book_folder_consistency_fk references
    // books(id, library_folder_id) with ON UPDATE CASCADE, so updating a file's
    // library_folder_id while the book still points at the old folder violates the FK.
    expect(setCalls).toEqual([
      { libraryId: 3, libraryFolderId: 9, folderPath: '/dst-lib/Frank Herbert/Dune' },
      { absolutePath: '/dst-lib/Frank Herbert/Dune/Dune.epub', relPath: 'Frank Herbert/Dune/Dune.epub', libraryFolderId: 9 },
      { absolutePath: '/dst-lib/Frank Herbert/Dune/cover.jpg', relPath: 'Frank Herbert/Dune/cover.jpg', libraryFolderId: 9 },
    ]);
  });
});
