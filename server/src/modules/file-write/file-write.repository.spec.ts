import { FileWriteRepository } from './file-write.repository';

describe('FileWriteRepository', () => {
  function chain<T>(result: T) {
    return {
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue(result),
      orderBy: jest.fn().mockResolvedValue(result),
    };
  }

  it('findPrimaryFileForBook returns row or null', async () => {
    const primary = { id: 1, absolutePath: '/a.epub', format: 'epub', sizeBytes: 5, libraryId: 10 };
    const c1 = chain([primary]);
    const c2 = chain([]);

    const db = {
      select: jest
        .fn()
        .mockReturnValueOnce(c1)
        .mockReturnValueOnce(c2),
    };

    const repo = new FileWriteRepository(db as never);

    await expect(repo.findPrimaryFileForBook(1)).resolves.toEqual(primary);
    await expect(repo.findPrimaryFileForBook(2)).resolves.toBeNull();
  });

  it('loadPayload returns null when metadata row is absent', async () => {
    const metaChain = chain([]);
    const db = { select: jest.fn().mockReturnValue(metaChain) };

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
      rating: 8,
      googleBooksId: 'g',
      goodreadsId: 'gr',
      amazonId: 'a',
      hardcoverId: 'h',
      openLibraryId: 'ol',
    };

    const metaChain = chain([meta]);
    const authorChain = {
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockResolvedValue([{ name: 'Frank Herbert', sortName: 'Herbert, Frank' }]),
    };
    const genreChain = {
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue([{ name: 'Sci-Fi' }]),
    };
    const tagChain = {
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue([{ name: 'Classic' }]),
    };

    const db = {
      select: jest
        .fn()
        .mockReturnValueOnce(metaChain)
        .mockReturnValueOnce(authorChain)
        .mockReturnValueOnce(genreChain)
        .mockReturnValueOnce(tagChain),
    };

    const repo = new FileWriteRepository(db as never);

    await expect(repo.loadPayload(9)).resolves.toEqual({
      ...meta,
      authors: [{ name: 'Frank Herbert', sortName: 'Herbert, Frank' }],
      genres: ['Sci-Fi'],
      tags: ['Classic'],
    });
  });

  it('insertLog maps write result fields correctly', async () => {
    const values = jest.fn().mockResolvedValue(undefined);
    const db = {
      insert: jest.fn().mockReturnValue({ values }),
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
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([
        {
          id: 8,
          format: 'epub',
          status: 'success',
          fieldsWritten: null,
          triggeredBy: 'auto',
          writtenAt: rowDate,
          durationMs: 20,
          errorMessage: null,
        },
      ]),
    };
    const db = { select: jest.fn().mockReturnValue(selectChain) };

    const repo = new FileWriteRepository(db as never);

    await expect(repo.findWriteLog(99, 1)).resolves.toEqual([
      {
        id: 8,
        format: 'epub',
        status: 'success',
        fieldsWritten: [],
        triggeredBy: 'auto',
        writtenAt: rowDate.toISOString(),
        durationMs: 20,
        errorMessage: null,
      },
    ]);
  });
});
