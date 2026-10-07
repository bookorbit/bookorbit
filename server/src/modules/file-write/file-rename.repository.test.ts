import { FileRenameRepository } from './file-rename.repository';

describe('FileRenameRepository', () => {
  function chain<T>(result: T) {
    return {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(result),
      orderBy: vi.fn().mockResolvedValue(result),
    };
  }

  it('findBookRenameData maps book, library, and author rename metadata', async () => {
    const row = {
      fileId: 10,
      absolutePath: '/library/old-folder/Old Title.epub',
      relPath: 'old-folder/Old Title.epub',
      format: 'epub',
      role: 'primary',
      mediaOverlayAvailable: true,
      libraryFolderId: 20,
      libraryFolderPath: '/library',
      libraryId: 30,
      organizationMode: 'book_per_folder',
      fileRenameEnabled: true,
      fileNamingPattern: '{authors}/{title}/{title}',
      bookFolderPath: '/library/old-folder',
      title: 'Dune',
      subtitle: 'Book One',
      publisher: 'Ace',
      language: 'en',
      isbn10: '0441172717',
      isbn13: '9780441172719',
      publishedYear: 1965,
      seriesName: 'Dune',
      seriesIndex: '1',
    };

    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValue([row]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockResolvedValue([{ name: 'Frank Herbert' }, { name: 'Brian Herbert' }]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockResolvedValue([{ name: 'Simon Vance' }]),
        }),
    };

    const repo = new FileRenameRepository(db as never);

    await expect(repo.findBookRenameData(7)).resolves.toEqual({
      file: {
        id: 10,
        absolutePath: '/library/old-folder/Old Title.epub',
        relPath: 'old-folder/Old Title.epub',
        format: 'epub',
        role: 'primary',
        mediaOverlayAvailable: true,
      },
      libraryId: 30,
      libraryFolderId: 20,
      libraryFolderPath: '/library',
      organizationMode: 'book_per_folder',
      fileRenameEnabled: true,
      fileNamingPattern: '{authors}/{title}/{title}',
      bookFolderPath: '/library/old-folder',
      metadata: {
        title: 'Dune',
        subtitle: 'Book One',
        publisher: 'Ace',
        language: 'en',
        isbn10: '0441172717',
        isbn13: '9780441172719',
        publishedYear: 1965,
        seriesName: 'Dune',
        seriesIndex: '1',
      },
      authors: ['Frank Herbert', 'Brian Herbert'],
      narrators: ['Simon Vance'],
    });
  });

  it('updateBookFilePath updates absolutePath and relPath', async () => {
    const setCalls: unknown[] = [];
    const db = {
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn().mockImplementation((values: unknown) => {
          setCalls.push(values);
          return { where: vi.fn().mockResolvedValue(undefined) };
        }),
      })),
    };

    const repo = new FileRenameRepository(db as never);

    await repo.updateBookFilePath(10, '/library/new-folder/Dune.epub', 'new-folder/Dune.epub');

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(setCalls).toEqual([{ absolutePath: '/library/new-folder/Dune.epub', relPath: 'new-folder/Dune.epub' }]);
  });

  it('updateBookFolderPath updates folderPath', async () => {
    const setCalls: unknown[] = [];
    const db = {
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn().mockImplementation((values: unknown) => {
          setCalls.push(values);
          return { where: vi.fn().mockResolvedValue(undefined) };
        }),
      })),
    };

    const repo = new FileRenameRepository(db as never);

    await repo.updateBookFolderPath(5, '/library/new-folder');

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(setCalls).toEqual([{ folderPath: '/library/new-folder' }]);
  });

  it('applyFolderRename updates every file path and the stored book folder', async () => {
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

    const repo = new FileRenameRepository(db as never);

    await repo.applyFolderRename(
      5,
      [
        { id: 10, absolutePath: '/library/Frank Herbert/Dune/Dune.epub', relPath: 'Frank Herbert/Dune/Dune.epub' },
        { id: 11, absolutePath: '/library/Frank Herbert/Dune/cover.jpg', relPath: 'Frank Herbert/Dune/cover.jpg' },
      ],
      '/library/Frank Herbert/Dune',
    );

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(setCalls).toEqual([
      { absolutePath: '/library/Frank Herbert/Dune/Dune.epub', relPath: 'Frank Herbert/Dune/Dune.epub' },
      { absolutePath: '/library/Frank Herbert/Dune/cover.jpg', relPath: 'Frank Herbert/Dune/cover.jpg' },
      { folderPath: '/library/Frank Herbert/Dune' },
    ]);
  });

  it('findFolderOwners maps each held folder to its book, title, and first-listed author', async () => {
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          leftJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValue([
            { bookId: 99, folderPath: '/library/Frank Herbert/Dune', title: 'Dune' },
            { bookId: 100, folderPath: '/library/Anonymous/Beowulf', title: null },
          ]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockResolvedValue([
            { bookId: 99, name: 'Frank Herbert' },
            { bookId: 99, name: 'Brian Herbert' },
          ]),
        }),
    };

    const repo = new FileRenameRepository(db as never);
    const owners = await repo.findFolderOwners(3, ['/library/Frank Herbert/Dune', '/library/Anonymous/Beowulf', '/library/Frank Herbert/Dune']);

    expect(owners).toEqual(
      new Map([
        ['/library/Frank Herbert/Dune', { bookId: 99, title: 'Dune', primaryAuthor: 'Frank Herbert' }],
        ['/library/Anonymous/Beowulf', { bookId: 100, title: null, primaryAuthor: null }],
      ]),
    );
  });

  it('findFolderOwners skips the author query when no book holds any of the folders', async () => {
    const db = {
      select: vi.fn().mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      }),
    };

    const repo = new FileRenameRepository(db as never);

    await expect(repo.findFolderOwners(3, ['/library/Frank Herbert/Dune'])).resolves.toEqual(new Map());
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('applyExistingFolderMerge reassigns files, deletes the source book, and fills a missing target primary', async () => {
    const setCalls: unknown[] = [];
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const tx = {
      execute: vi.fn().mockResolvedValue(undefined),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        for: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ libraryFolderId: 7, primaryFileId: null }]),
      }),
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn().mockImplementation((values: unknown) => {
          setCalls.push(values);
          return { where: vi.fn().mockResolvedValue(undefined) };
        }),
      })),
      delete: vi.fn().mockReturnValue({ where: deleteWhere }),
    };
    const db = {
      transaction: vi.fn().mockImplementation(async (callback: (value: unknown) => Promise<unknown>) => callback(tx)),
    };

    const repo = new FileRenameRepository(db as never);

    await repo.applyExistingFolderMerge({
      sourceBookId: 5,
      targetBookId: 99,
      fallbackPrimaryFileId: 10,
      updates: [
        { id: 10, absolutePath: '/library/Author/Book/Book.epub', relPath: 'Author/Book/Book.epub' },
        { id: 11, absolutePath: '/library/Author/Book/old.opf', relPath: 'Author/Book/old.opf' },
      ],
    });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(setCalls).toEqual([
      expect.objectContaining({ bookId: 99, libraryFolderId: 7, absolutePath: '/library/Author/Book/Book.epub', relPath: 'Author/Book/Book.epub' }),
      expect.objectContaining({ bookId: 99, libraryFolderId: 7, absolutePath: '/library/Author/Book/old.opf', relPath: 'Author/Book/old.opf' }),
      expect.objectContaining({ primaryFileId: 10, status: 'present' }),
    ]);
    expect(tx.execute).toHaveBeenCalledTimes(1);
    expect(tx.delete).not.toHaveBeenCalled();
  });

  it('applyExistingFolderMerge does not replace an existing target primary file', async () => {
    const setCalls: unknown[] = [];
    const tx = {
      execute: vi.fn().mockResolvedValue(undefined),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        for: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ libraryFolderId: 7, primaryFileId: 42 }]),
      }),
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn().mockImplementation((values: unknown) => {
          setCalls.push(values);
          return { where: vi.fn().mockResolvedValue(undefined) };
        }),
      })),
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    };
    const db = {
      transaction: vi.fn().mockImplementation(async (callback: (value: unknown) => Promise<unknown>) => callback(tx)),
    };

    const repo = new FileRenameRepository(db as never);

    await repo.applyExistingFolderMerge({
      sourceBookId: 5,
      targetBookId: 99,
      fallbackPrimaryFileId: 10,
      updates: [{ id: 10, absolutePath: '/library/Author/Book/Book.epub', relPath: 'Author/Book/Book.epub' }],
    });

    expect(setCalls.at(-1)).toEqual(expect.not.objectContaining({ primaryFileId: 10 }));
    expect(setCalls.at(-1)).toEqual(expect.objectContaining({ status: 'present' }));
  });

  it('checkPathTakenByOtherBook only flags collisions from other books', async () => {
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(chain([{ bookId: 8 }]))
        .mockReturnValueOnce(chain([{ bookId: 5 }]))
        .mockReturnValueOnce(chain([])),
    };

    const repo = new FileRenameRepository(db as never);

    await expect(repo.checkPathTakenByOtherBook('/library/Dune.epub', 5)).resolves.toBe(true);
    await expect(repo.checkPathTakenByOtherBook('/library/Dune.epub', 5)).resolves.toBe(false);
    await expect(repo.checkPathTakenByOtherBook('/library/Dune.epub', 5)).resolves.toBe(false);
  });
});
