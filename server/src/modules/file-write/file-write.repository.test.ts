import { FileWriteRepository } from './file-write.repository';

describe('FileWriteRepository', () => {
  function chain<T>(result: T) {
    return {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(result),
      orderBy: vi.fn().mockResolvedValue(result),
    };
  }

  it('findPrimaryFileForBook returns row or null', async () => {
    const primary = { id: 1, absolutePath: '/a.epub', format: 'epub', sizeBytes: 5, fileHash: 'hash', libraryId: 10 };
    const c1 = chain([primary]);
    const c2 = chain([]);

    const db = {
      select: vi.fn().mockReturnValueOnce(c1).mockReturnValueOnce(c2),
    };

    const repo = new FileWriteRepository(db as never);

    await expect(repo.findPrimaryFileForBook(1)).resolves.toEqual(primary);
    await expect(repo.findPrimaryFileForBook(2)).resolves.toBeNull();
  });

  it('findFilesForBook returns all file write targets in stable order', async () => {
    const rows = [
      { id: 1, absolutePath: '/a/01.mp3', format: 'mp3', sizeBytes: 5, fileHash: 'hash1', libraryId: 10 },
      { id: 2, absolutePath: '/a/02.mp3', format: 'mp3', sizeBytes: 6, fileHash: 'hash2', libraryId: 10 },
    ];
    const c = chain(rows);
    const db = {
      select: vi.fn().mockReturnValue(c),
    };

    const repo = new FileWriteRepository(db as never);

    await expect(repo.findFilesForBook(1)).resolves.toEqual(rows);
    expect(c.orderBy).toHaveBeenCalledTimes(1);
  });

  it('findLibraryFileWriteConfig selects audio write-back settings', async () => {
    const settings = {
      fileWriteEnabled: true,
      fileWriteWriteCover: true,
      fileWriteEpubEnabled: true,
      fileWriteEpubMaxFileSizeMb: 100,
      fileWritePdfEnabled: true,
      fileWritePdfMaxFileSizeMb: 100,
      fileWriteCbxEnabled: false,
      fileWriteCbxMaxFileSizeMb: 500,
      fileWriteAudioEnabled: true,
      fileWriteAudioMaxFileSizeMb: 500,
    };
    const c = chain([settings]);
    const db = {
      select: vi.fn().mockReturnValue(c),
    };

    const repo = new FileWriteRepository(db as never);

    await expect(repo.findLibraryFileWriteConfig(10)).resolves.toEqual(settings);
    expect(db.select).toHaveBeenCalledWith(
      expect.objectContaining({ fileWriteAudioEnabled: expect.anything(), fileWriteAudioMaxFileSizeMb: expect.anything() }),
    );
  });

  it('loadPayload returns null when metadata row is absent', async () => {
    const metaChain = chain([]);
    const db = { select: vi.fn().mockReturnValue(metaChain) };

    const repo = new FileWriteRepository(db as never);

    await expect(repo.loadPayload(11)).resolves.toBeNull();
  });

  it('loadPayload maps metadata, authors, genres, and tags', async () => {
    const meta = {
      title: 'Dune',
      subtitle: 'Book One',
      description: 'Arrakis',
      publisher: 'Ace',
      publishedYear: 1965,
      language: 'en',
      pageCount: 412,
      seriesName: 'Dune',
      seriesIndex: 1,
      isbn10: '123',
      isbn13: '978123',
      googleBooksId: 'g',
      goodreadsId: 'gr',
      amazonId: 'a',
      hardcoverId: 'h',
      openLibraryId: 'ol',
      ranobedbId: 'rn',
      itunesId: 'it',
      audibleId: 'aud',
      rating: 4,
    };

    const metaChain = chain([meta]);
    const authorChain = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([{ name: 'Frank Herbert', sortName: 'Herbert, Frank' }]),
    };
    const genreChain = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([{ name: 'Sci-Fi' }]),
    };
    const tagChain = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([{ name: 'Classic' }]),
    };
    const narratorChain = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([{ name: 'Simon Vance' }]),
    };
    const comicChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          issueNumber: '12',
          volumeName: 'Volume One',
          pencillers: ['Penciller A'],
          inkers: ['Inker A'],
          colorists: ['Colorist A'],
          letterers: ['Letterer A'],
          coverArtists: ['Cover Artist A'],
          characters: ['Character A'],
          teams: ['Team A'],
          locations: ['Location A'],
          storyArcs: ['Arc A'],
        },
      ]),
    };

    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(metaChain)
        .mockReturnValueOnce(authorChain)
        .mockReturnValueOnce(narratorChain)
        .mockReturnValueOnce(genreChain)
        .mockReturnValueOnce(tagChain)
        .mockReturnValueOnce(comicChain),
    };

    const repo = new FileWriteRepository(db as never);

    await expect(repo.loadPayload(9)).resolves.toEqual({
      ...meta,
      authors: [{ name: 'Frank Herbert', sortName: 'Herbert, Frank' }],
      narrators: ['Simon Vance'],
      genres: ['Sci-Fi'],
      tags: ['Classic'],
      comicIssueNumber: '12',
      comicVolumeName: 'Volume One',
      comicPencillers: ['Penciller A'],
      comicInkers: ['Inker A'],
      comicColorists: ['Colorist A'],
      comicLetterers: ['Letterer A'],
      comicCoverArtists: ['Cover Artist A'],
      comicCharacters: ['Character A'],
      comicTeams: ['Team A'],
      comicLocations: ['Location A'],
      comicStoryArcs: ['Arc A'],
    });
  });

  it('insertLog maps write result fields correctly', async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const db = {
      insert: vi.fn().mockReturnValue({ values }),
    };

    const repo = new FileWriteRepository(db as never);

    await repo.insertLog({
      bookId: 1,
      bookFileId: 2,
      userId: 3,
      format: 'pdf',
      triggeredBy: 'sync',
      result: { status: 'failed', fieldsWritten: ['title'], durationMs: 90, reason: 'bad file' },
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        bookId: 1,
        bookFileId: 2,
        userId: 3,
        format: 'pdf',
        status: 'failed',
        fieldsWritten: ['title'],
        errorMessage: 'bad file',
        durationMs: 90,
        triggeredBy: 'sync',
      }),
    );
  });

  it('findWriteLog normalizes fieldsWritten and writtenAt', async () => {
    const rowDate = new Date('2025-01-02T03:04:05.000Z');

    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          id: 8,
          format: 'epub',
          status: 'success',
          fieldsWritten: ['title', 123, 'genres'],
          triggeredBy: 'auto',
          writtenAt: rowDate,
          durationMs: 20,
          errorMessage: null,
        },
      ]),
    };
    const db = { select: vi.fn().mockReturnValue(selectChain) };

    const repo = new FileWriteRepository(db as never);

    await expect(repo.findWriteLog(99, 1)).resolves.toEqual([
      {
        id: 8,
        format: 'epub',
        status: 'success',
        fieldsWritten: ['title', 'genres'],
        triggeredBy: 'auto',
        writtenAt: rowDate.toISOString(),
        durationMs: 20,
        errorMessage: null,
      },
    ]);
  });

  it('findLibraryWriteSettingsForBook returns settings or null without joining bookFiles', async () => {
    const settings = { fileWriteEnabled: true, fileRenameEnabled: false };
    const c1 = chain([settings]);
    const c2 = chain([]);

    const db = {
      select: vi.fn().mockReturnValueOnce(c1).mockReturnValueOnce(c2),
    };

    const repo = new FileWriteRepository(db as never);

    await expect(repo.findLibraryWriteSettingsForBook(1)).resolves.toEqual(settings);
    await expect(repo.findLibraryWriteSettingsForBook(2)).resolves.toBeNull();

    // innerJoin is called exactly once per query (books -> libraries only, no bookFiles join)
    expect(c1.innerJoin).toHaveBeenCalledTimes(1);
  });
});
