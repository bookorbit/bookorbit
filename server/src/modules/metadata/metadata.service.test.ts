vi.mock('fs/promises', () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  readdir: vi.fn().mockResolvedValue([]),
  rm: vi.fn(),
}));

vi.mock('./lib/cover', () => ({
  generateThumbnail: vi.fn(),
  imageExt: vi.fn(),
}));

vi.mock('./lib/cbz-metadata', () => ({
  extractCbzMetadata: vi.fn(),
  extractCbrMetadata: vi.fn(),
  extractCb7Metadata: vi.fn(),
}));

vi.mock('./lib/epub', () => ({
  extractEpubMetadata: vi.fn(),
}));

vi.mock('./lib/cover-epub', () => ({
  extractEpubCover: vi.fn().mockImplementation(() => Promise.resolve(null)),
}));

vi.mock('./lib/cover-fb2', () => ({
  extractFb2Cover: vi.fn().mockImplementation(() => Promise.resolve(null)),
}));

vi.mock('./lib/cover-cbz', () => ({
  extractCbzCover: vi.fn().mockImplementation(() => Promise.resolve(null)),
}));

vi.mock('./lib/cover-cbr', () => ({
  extractCbrCover: vi.fn().mockImplementation(() => Promise.resolve(null)),
}));

vi.mock('./lib/cover-cb7', () => ({
  extractCb7Cover: vi.fn().mockImplementation(() => Promise.resolve(null)),
}));

vi.mock('./lib/filename-parser', () => ({
  parseBookFilename: vi.fn(),
}));

vi.mock('./lib/fb2-parser', () => ({
  parseFb2File: vi.fn(),
}));

vi.mock('./lib/mobi-parser', () => ({
  parseMobiFile: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  extractMobiCover: (_path: string) => Promise.resolve(null),
}));

vi.mock('./lib/pdf-parser', () => ({
  parsePdfFile: vi.fn(),
}));

vi.mock('./extractors/audio.extractor', () => ({
  extractAudioMetadata: vi.fn().mockImplementation(() =>
    Promise.resolve({
      title: null,
      authors: [],
      narrators: [],
      publisher: null,
      publishedYear: null,
      description: null,
      language: null,
      durationSeconds: null,
      chapters: [],
      coverBytes: null,
    }),
  ),
  parseAudioDuration: vi.fn().mockImplementation(() => Promise.resolve(null)),
}));

import { mkdir, readdir, rm, writeFile } from 'fs/promises';
import { Logger } from '@nestjs/common';

import { authors, bookAuthors, bookGenres, bookMetadata, bookTags, genres, tags } from '../../db/schema';
import { generateThumbnail, imageExt } from './lib/cover';
import { parseBookFilename } from './lib/filename-parser';
import { parseMobiFile } from './lib/mobi-parser';
import { parsePdfFile } from './lib/pdf-parser';
import { METADATA_AUTHORS_REPLACED } from './metadata-events.service';
import { MetadataService } from './metadata.service';

const mockMkdir = mkdir as MockedFunction<typeof mkdir>;
const mockWriteFile = writeFile as MockedFunction<typeof writeFile>;
const mockReaddir = readdir as MockedFunction<typeof readdir>;
const mockRm = rm as MockedFunction<typeof rm>;
const mockGenerateThumbnail = generateThumbnail as MockedFunction<typeof generateThumbnail>;
const mockImageExt = imageExt as MockedFunction<typeof imageExt>;
const mockParseBookFilename = parseBookFilename as MockedFunction<typeof parseBookFilename>;
const mockParseMobiFile = parseMobiFile as MockedFunction<typeof parseMobiFile>;
const mockParsePdfFile = parsePdfFile as MockedFunction<typeof parsePdfFile>;

const makeDb = () => {
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const deleteBuilder = { where: deleteWhere };

  const selectLimit = vi.fn().mockResolvedValue([]);
  const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit });
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });

  const insertReturning = vi.fn().mockResolvedValue([]);
  const insertOnConflictDoNothing = vi.fn().mockResolvedValue(undefined);
  const insertValues = vi.fn().mockReturnValue({
    returning: insertReturning,
    onConflictDoNothing: insertOnConflictDoNothing,
  });

  const db: any = {
    update: vi.fn().mockReturnValue({ set: updateSet }),
    delete: vi.fn().mockReturnValue(deleteBuilder),
    select: vi.fn().mockReturnValue({ from: selectFrom }),
    insert: vi.fn().mockReturnValue({ values: insertValues }),
  };
  const transaction = vi.fn().mockImplementation(async (callback: (tx: typeof db) => Promise<unknown>) => callback(db));
  db.transaction = transaction;

  return {
    db,
    updateSet,
    updateWhere,
    deleteWhere,
    selectLimit,
    insertValues,
    transaction,
  };
};

describe('MetadataService', () => {
  const config = { get: vi.fn().mockReturnValue('/books') };
  const embedder = { embedBook: vi.fn().mockResolvedValue(undefined) };

  beforeEach(() => {
    vi.resetAllMocks();

    config.get.mockReturnValue('/books');
    embedder.embedBook.mockResolvedValue(undefined);

    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue([]);
    mockRm.mockResolvedValue(undefined);
    mockGenerateThumbnail.mockResolvedValue(Buffer.from('thumbnail-bytes'));
    mockImageExt.mockReturnValue('png');
    mockParseBookFilename.mockReturnValue({ title: 'Fallback Title', publishedYear: 2001 });
    mockParseMobiFile.mockResolvedValue(null);
    mockParsePdfFile.mockResolvedValue(null);
  });

  function makeService(db: unknown, metadataEvents?: unknown) {
    return new MetadataService(
      db as never,
      config as never,
      { calculateAndSave: vi.fn().mockResolvedValue(undefined) } as never,
      { replaceForBook: vi.fn().mockResolvedValue(undefined) } as never,
      { upsert: vi.fn().mockResolvedValue(undefined) } as never,
      {
        isFieldLocked: vi.fn().mockResolvedValue(false),
        filterAutomatedBookUpdate: vi.fn().mockImplementation((_bookId: number, dto: unknown) => Promise.resolve({ dto, skippedFields: [] })),
      } as never,
      embedder as never,
      metadataEvents as never,
    );
  }

  it('downloadAndSaveCover writes cover/thumbnail and updates metadata when download is valid', async () => {
    const { db, updateSet } = makeDb();
    const service = makeService(db);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(Buffer.from('image-bytes')),
    }) as never;

    await expect(service.downloadAndSaveCover('https://img.example/cover.png', 9)).resolves.toBe(true);

    expect(mockMkdir).toHaveBeenCalledWith('/books/covers/9', { recursive: true });
    expect(mockWriteFile).toHaveBeenCalledWith('/books/covers/9/cover_extracted.png', Buffer.from('image-bytes'));
    expect(mockWriteFile).toHaveBeenCalledWith('/books/covers/9/thumbnail.jpg', Buffer.from('thumbnail-bytes'));
    expect(db.update).toHaveBeenCalledWith(bookMetadata);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ coverSource: 'extracted', updatedAt: expect.any(Date) }));
  });

  it('saveExtractedCoverBytes removes stale extracted files before writing new cover', async () => {
    const { db } = makeDb();
    const service = makeService(db);
    mockReaddir.mockResolvedValue(['cover_extracted.jpg', 'cover_extracted.png']);

    await service.saveExtractedCoverBytes(11, Buffer.from('image-bytes'));

    expect(mockRm).toHaveBeenCalledWith('/books/covers/11/cover_extracted.jpg', { force: true });
    expect(mockRm).toHaveBeenCalledWith('/books/covers/11/cover_extracted.png', { force: true });
    expect(mockWriteFile).toHaveBeenCalledWith('/books/covers/11/cover_extracted.png', Buffer.from('image-bytes'));
  });

  it('downloadAndSaveCover no-ops on empty payloads and network failures', async () => {
    const { db } = makeDb();
    const service = makeService(db);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(Buffer.alloc(0)),
    }) as never;
    await expect(service.downloadAndSaveCover('https://img.example/empty.png', 4)).resolves.toBe(false);

    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();

    (global.fetch as vi.Mock).mockRejectedValue(new Error('timeout'));
    await expect(service.downloadAndSaveCover('https://img.example/fail.png', 4)).resolves.toBe(false);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('refreshCoverForBook returns false and avoids db writes when extractor reports no cover', async () => {
    const { db } = makeDb();
    const service = makeService(db);
    // extractEpubCover is mocked to return null by default; parsePdfFile returns null → no cover
    await expect(service.refreshCoverForBook(7, '/book.epub', 'epub')).resolves.toBe(false);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('extractAndSave propagates extractor errors', async () => {
    const { db } = makeDb();
    mockParsePdfFile.mockRejectedValue(new Error('bad metadata'));
    const service = makeService(db);

    await expect(service.extractAndSave(15, '/books/a.pdf', 'pdf')).rejects.toThrow('bad metadata');
  });

  it('extractAndSave(pdf) surfaces parser warnings in logs', async () => {
    const { db } = makeDb();
    const service = makeService(db);
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    mockParsePdfFile.mockImplementation((_absolutePath, options) => {
      options?.onWarning?.({
        code: 'cover-extraction-failed',
        absolutePath: '/tmp/warn.pdf',
        errorClass: 'Error',
        errorMessage: 'pdftoppm missing',
      });

      return Promise.resolve({
        title: 'Warn PDF',
        subtitle: null,
        description: null,
        isbn10: null,
        isbn13: null,
        publisher: null,
        publishedYear: null,
        language: null,
        seriesName: null,
        seriesIndex: null,
        authors: [],
        genres: [],
        tags: [],
        rating: null,
        pageCount: null,
        googleBooksId: null,
        goodreadsId: null,
        amazonId: null,
        hardcoverId: null,
        openLibraryId: null,
        itunesId: null,
        coverBuffer: null,
      });
    });

    await service.extractAndSave(21, '/tmp/warn.pdf', 'pdf');

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[metadata.pdf_parse] [fail]'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('pdftoppm missing'));
  });

  it('extractAndSave(pdf) persists fallback title/year, page count, and extracted cover bytes', async () => {
    const { db, updateSet } = makeDb();
    const service = makeService(db);
    const replaceAuthorsSpy = vi.spyOn(service, 'replaceAuthors').mockResolvedValue(undefined);
    const replaceGenresSpy = vi.spyOn(service, 'replaceGenres').mockResolvedValue(undefined);
    const replaceTagsSpy = vi.spyOn(service, 'replaceTags').mockResolvedValue(undefined);

    mockParsePdfFile.mockResolvedValue({
      title: null,
      subtitle: 'Subtitle',
      description: 'Description',
      isbn10: '1234567890',
      isbn13: '9781234567897',
      publisher: 'Publisher',
      publishedYear: null,
      language: 'en',
      seriesName: 'Series',
      seriesIndex: 2,
      authors: [{ name: 'Author A', sortName: null }],
      genres: ['Fantasy'],
      tags: ['Shelf'],
      rating: 4.6,
      pageCount: 321,
      googleBooksId: 'google-1',
      goodreadsId: 'goodreads-1',
      amazonId: 'amazon-1',
      hardcoverId: 'hardcover-1',
      openLibraryId: 'open-library-1',
      itunesId: 'itunes-1',
      coverBuffer: Buffer.from('jpeg-bytes'),
    });
    mockParseBookFilename.mockReturnValue({ title: 'Title From Filename', publishedYear: 1999 });

    await service.extractAndSave(22, '/tmp/book.pdf', 'pdf');

    expect(mockParsePdfFile).toHaveBeenCalledWith(
      '/tmp/book.pdf',
      expect.objectContaining({
        extractCover: true,
        onWarning: expect.any(Function),
      }),
    );

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Title From Filename',
        publishedYear: 1999,
        subtitle: 'Subtitle',
        description: 'Description',
        pageCount: 321,
        rating: 5,
        googleBooksId: 'google-1',
        goodreadsId: 'goodreads-1',
        amazonId: 'amazon-1',
        hardcoverId: 'hardcover-1',
        openLibraryId: 'open-library-1',
        itunesId: 'itunes-1',
        updatedAt: expect.any(Date),
      }),
    );
    expect(mockWriteFile).toHaveBeenCalledWith('/books/covers/22/cover_extracted.png', Buffer.from('jpeg-bytes'));
    expect(replaceAuthorsSpy).toHaveBeenCalledWith(22, [{ name: 'Author A', sortName: null }]);
    expect(replaceGenresSpy).toHaveBeenCalledWith(22, ['Fantasy']);
    expect(replaceTagsSpy).toHaveBeenCalledWith(22, ['Shelf']);
    expect(embedder.embedBook).toHaveBeenCalledWith(22);
  });

  it('extractAndSave(mobi) ignores malformed publishedDate values from providers', async () => {
    const { db, updateSet } = makeDb();
    const service = makeService(db);
    vi.spyOn(service, 'replaceAuthors').mockResolvedValue(undefined);
    vi.spyOn(service, 'replaceGenres').mockResolvedValue(undefined);

    mockParseMobiFile.mockResolvedValue({
      title: 'Mobi Title',
      description: null,
      isbn: 'isbn',
      publisher: null,
      publishedDate: '20',
      language: 'en',
      authors: ['Author'],
      tags: ['Tag'],
    });

    await service.extractAndSave(33, '/tmp/book.mobi', 'mobi');

    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ publishedYear: null }));
  });

  it('replaceAuthors normalizes names and deduplicates case-insensitively before db writes', async () => {
    const { db, deleteWhere, transaction } = makeDb();
    const service = makeService(db);
    const insertedAuthors: Array<{ name: string; sortName: string | null }> = [];
    const insertedBookAuthors: Array<{ bookId: number; authorId: number; displayOrder: number }> = [];

    db.insert.mockImplementation((table: unknown) => {
      if (table === authors) {
        return {
          values: (rows: Array<{ name: string; sortName: string | null }>) => {
            insertedAuthors.push(...rows);
            return {
              onConflictDoNothing: () => ({
                returning: () => Promise.resolve([{ id: 81, name: 'Alice' }]),
              }),
            };
          },
        };
      }
      if (table === bookAuthors) {
        return {
          values: (rows: Array<{ bookId: number; authorId: number; displayOrder: number }>) => {
            insertedBookAuthors.push(...rows);
            return { onConflictDoNothing: () => Promise.resolve(undefined) };
          },
        };
      }
      throw new Error('unexpected table in insert');
    });

    await service.replaceAuthors(5, [
      { name: '  Alice  ', sortName: '   ' },
      { name: 'alice', sortName: 'ignored duplicate' },
      { name: '   ', sortName: null },
    ]);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(db.delete).toHaveBeenCalledWith(bookAuthors);
    expect(deleteWhere).toHaveBeenCalledTimes(1);
    expect(db.select).not.toHaveBeenCalled();
    expect(insertedAuthors).toEqual([{ name: 'Alice', sortName: null }]);
    expect(insertedBookAuthors).toEqual([{ bookId: 5, authorId: 81, displayOrder: 0 }]);
  });

  it('replaceAuthors reuses existing authors and only inserts join rows', async () => {
    const { db } = makeDb();
    const service = makeService(db);
    const insertedAuthors: Array<{ name: string; sortName: string | null }> = [];
    const insertedBookAuthors: Array<{ bookId: number; authorId: number; displayOrder: number }> = [];

    db.select.mockImplementation(() => ({
      from: () => ({
        where: () => Promise.resolve([{ id: 9, name: 'Known Author' }]),
      }),
    }));
    db.insert.mockImplementation((table: unknown) => {
      if (table === authors) {
        return {
          values: (rows: Array<{ name: string; sortName: string | null }>) => {
            insertedAuthors.push(...rows);
            return {
              onConflictDoNothing: () => ({
                returning: () => Promise.resolve([]),
              }),
            };
          },
        };
      }
      if (table === bookAuthors) {
        return {
          values: (rows: Array<{ bookId: number; authorId: number; displayOrder: number }>) => {
            insertedBookAuthors.push(...rows);
            return { onConflictDoNothing: () => Promise.resolve(undefined) };
          },
        };
      }
      throw new Error('unexpected table in insert');
    });

    await service.replaceAuthors(6, [{ name: 'Known Author', sortName: null }]);

    expect(insertedAuthors).toEqual([{ name: 'Known Author', sortName: null }]);
    expect(insertedBookAuthors).toEqual([{ bookId: 6, authorId: 9, displayOrder: 0 }]);
  });

  it('replaceAuthors emits author replaced event with linked author ids', async () => {
    const { db } = makeDb();
    const metadataEvents = { emit: vi.fn() };
    const service = makeService(db, metadataEvents);

    db.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    }));
    db.insert.mockImplementation((table: unknown) => {
      if (table === authors) {
        return {
          values: () => ({
            onConflictDoNothing: () => ({
              returning: () => Promise.resolve([{ id: 81, name: 'New Author' }]),
            }),
          }),
        };
      }
      if (table === bookAuthors) {
        return {
          values: () => ({
            onConflictDoNothing: () => Promise.resolve(undefined),
          }),
        };
      }
      throw new Error('unexpected table in insert');
    });

    await service.replaceAuthors(7, [{ name: 'New Author', sortName: null }]);

    expect(metadataEvents.emit).toHaveBeenCalledWith(METADATA_AUTHORS_REPLACED, { bookId: 7, authorIds: [81] });
  });

  it('replaceGenres runs in transaction and normalizes unique names', async () => {
    const { db, transaction } = makeDb();
    const service = makeService(db);
    const insertedGenres: string[] = [];
    const insertedBookGenres: Array<{ bookId: number; genreId: number }> = [];

    db.insert.mockImplementation((table: unknown) => {
      if (table === genres) {
        return {
          values: (rows: Array<{ name: string }>) => {
            insertedGenres.push(...rows.map((row) => row.name));
            return {
              onConflictDoNothing: () => ({
                returning: () => Promise.resolve(rows.map((row, index) => ({ id: 77 + index, name: row.name }))),
              }),
            };
          },
        };
      }
      if (table === bookGenres) {
        return {
          values: (rows: Array<{ bookId: number; genreId: number }>) => {
            insertedBookGenres.push(...rows);
            return { onConflictDoNothing: () => Promise.resolve(undefined) };
          },
        };
      }
      throw new Error('unexpected table in insert');
    });

    await service.replaceGenres(12, [' Fantasy ', 'Fantasy', '', 'X'.repeat(250)]);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(db.delete).toHaveBeenCalledWith(bookGenres);
    expect(insertedGenres).toEqual(['Fantasy', 'X'.repeat(200)]);
    expect(insertedBookGenres).toEqual([
      { bookId: 12, genreId: 77 },
      { bookId: 12, genreId: 78 },
    ]);
  });

  it('replaceTags runs in transaction and normalizes unique names', async () => {
    const { db, transaction } = makeDb();
    const service = makeService(db);
    const insertedTags: string[] = [];

    db.insert.mockImplementation((table: unknown) => {
      if (table === tags) {
        return {
          values: (rows: Array<{ name: string }>) => {
            insertedTags.push(...rows.map((row) => row.name));
            return {
              onConflictDoNothing: () => ({
                returning: () => Promise.resolve(rows.map((row, index) => ({ id: 88 + index, name: row.name }))),
              }),
            };
          },
        };
      }
      if (table === bookTags) {
        return {
          values: () => ({
            onConflictDoNothing: () => Promise.resolve(undefined),
          }),
        };
      }
      throw new Error('unexpected table in insert');
    });

    await service.replaceTags(19, [' Shelf ', 'Shelf', '', 'Y'.repeat(230)]);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(db.delete).toHaveBeenCalledWith(bookTags);
    expect(insertedTags).toEqual(['Shelf', 'Y'.repeat(200)]);
  });

  it('aggregateAudioDuration sums only files that match the selected primary audio format', async () => {
    const primaryWhere = vi.fn().mockResolvedValue([{ format: 'm4b' }]);
    const primaryInnerJoin = vi.fn().mockReturnValue({ where: primaryWhere });
    const primaryFrom = vi.fn().mockReturnValue({ innerJoin: primaryInnerJoin });

    const aggregateWhere = vi.fn().mockResolvedValue([{ total: 3600 }]);
    const aggregateFrom = vi.fn().mockReturnValue({ where: aggregateWhere });

    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    const db = {
      select: vi.fn().mockReturnValueOnce({ from: primaryFrom }).mockReturnValueOnce({ from: aggregateFrom }),
      update: vi.fn().mockReturnValue({ set: updateSet }),
    };

    const service = makeService(db);

    await service.aggregateAudioDuration(42);

    expect(primaryWhere).toHaveBeenCalledTimes(1);
    expect(aggregateWhere).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith({ durationSeconds: 3600 });
  });

  it('aggregateAudioDuration no-ops when selected primary file is not an audio format', async () => {
    const primaryWhere = vi.fn().mockResolvedValue([]);
    const primaryInnerJoin = vi.fn().mockReturnValue({ where: primaryWhere });
    const primaryFrom = vi.fn().mockReturnValue({ innerJoin: primaryInnerJoin });

    const db = {
      select: vi.fn().mockReturnValueOnce({ from: primaryFrom }),
      update: vi.fn(),
    };

    const service = makeService(db);

    await service.aggregateAudioDuration(99);

    expect(db.update).not.toHaveBeenCalled();
  });
});
