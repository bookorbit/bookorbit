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
      isbn13: '9780441172719',
      publishedYear: 1965,
      seriesName: 'Dune',
      seriesIndex: 1,
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
        isbn13: '9780441172719',
        publishedYear: 1965,
        seriesName: 'Dune',
        seriesIndex: 1,
      },
      authors: ['Frank Herbert', 'Brian Herbert'],
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
