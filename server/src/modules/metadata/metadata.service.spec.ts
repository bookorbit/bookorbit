jest.mock('fs/promises', () => ({
  mkdir: jest.fn(),
  writeFile: jest.fn(),
}));

jest.mock('./lib/cover', () => ({
  extractAndSaveCover: jest.fn(),
  generateThumbnail: jest.fn(),
  imageExt: jest.fn(),
}));

jest.mock('./lib/cbz-metadata', () => ({
  extractCbzMetadata: jest.fn(),
  extractCbrMetadata: jest.fn(),
  extractCb7Metadata: jest.fn(),
}));

jest.mock('./lib/epub', () => ({
  extractEpubMetadata: jest.fn(),
}));

jest.mock('./lib/filename-parser', () => ({
  parseBookFilename: jest.fn(),
}));

jest.mock('./lib/fb2-parser', () => ({
  parseFb2File: jest.fn(),
}));

jest.mock('./lib/mobi-parser', () => ({
  parseMobiFile: jest.fn(),
}));

jest.mock('./lib/pdf-parser', () => ({
  parsePdfFile: jest.fn(),
}));

import { mkdir, writeFile } from 'fs/promises';

import { authors, bookAuthors, bookMetadata } from '../../db/schema';
import { extractAndSaveCover, generateThumbnail, imageExt } from './lib/cover';
import { parseBookFilename } from './lib/filename-parser';
import { parseMobiFile } from './lib/mobi-parser';
import { parsePdfFile } from './lib/pdf-parser';
import { MetadataService } from './metadata.service';

const mockMkdir = mkdir as jest.MockedFunction<typeof mkdir>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;
const mockExtractAndSaveCover = extractAndSaveCover as jest.MockedFunction<typeof extractAndSaveCover>;
const mockGenerateThumbnail = generateThumbnail as jest.MockedFunction<typeof generateThumbnail>;
const mockImageExt = imageExt as jest.MockedFunction<typeof imageExt>;
const mockParseBookFilename = parseBookFilename as jest.MockedFunction<typeof parseBookFilename>;
const mockParseMobiFile = parseMobiFile as jest.MockedFunction<typeof parseMobiFile>;
const mockParsePdfFile = parsePdfFile as jest.MockedFunction<typeof parsePdfFile>;

const makeDb = () => {
  const updateWhere = jest.fn().mockResolvedValue(undefined);
  const updateSet = jest.fn().mockReturnValue({ where: updateWhere });

  const deleteWhere = jest.fn().mockResolvedValue(undefined);
  const deleteBuilder = { where: deleteWhere };

  const selectLimit = jest.fn().mockResolvedValue([]);
  const selectWhere = jest.fn().mockReturnValue({ limit: selectLimit });
  const selectFrom = jest.fn().mockReturnValue({ where: selectWhere });

  const insertReturning = jest.fn().mockResolvedValue([]);
  const insertOnConflictDoNothing = jest.fn().mockResolvedValue(undefined);
  const insertValues = jest.fn().mockReturnValue({
    returning: insertReturning,
    onConflictDoNothing: insertOnConflictDoNothing,
  });

  const db = {
    update: jest.fn().mockReturnValue({ set: updateSet }),
    delete: jest.fn().mockReturnValue(deleteBuilder),
    select: jest.fn().mockReturnValue({ from: selectFrom }),
    insert: jest.fn().mockReturnValue({ values: insertValues }),
  };

  return {
    db,
    updateSet,
    updateWhere,
    deleteWhere,
    selectLimit,
    insertValues,
  };
};

describe('MetadataService', () => {
  const config = { get: jest.fn().mockReturnValue('/books') };
  const embedder = { embedBook: jest.fn().mockResolvedValue(undefined) };

  beforeEach(() => {
    jest.resetAllMocks();

    config.get.mockReturnValue('/books');
    embedder.embedBook.mockResolvedValue(undefined);

    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockGenerateThumbnail.mockResolvedValue(Buffer.from('thumbnail-bytes'));
    mockImageExt.mockReturnValue('png');
    mockExtractAndSaveCover.mockResolvedValue('/books/covers/7/cover_extracted.jpg');
    mockParseBookFilename.mockReturnValue({ title: 'Fallback Title', publishedYear: 2001 });
    mockParseMobiFile.mockResolvedValue(null);
    mockParsePdfFile.mockResolvedValue(null);
  });

  it('downloadAndSaveCover writes cover/thumbnail and updates metadata when download is valid', async () => {
    const { db, updateSet } = makeDb();
    const service = new MetadataService(db as never, config as never, embedder as never);

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Buffer.from('image-bytes'),
    }) as never;

    await service.downloadAndSaveCover('https://img.example/cover.png', 9);

    expect(mockMkdir).toHaveBeenCalledWith('/books/covers/9', { recursive: true });
    expect(mockWriteFile).toHaveBeenCalledWith('/books/covers/9/cover_extracted.png', Buffer.from('image-bytes'));
    expect(mockWriteFile).toHaveBeenCalledWith('/books/covers/9/thumbnail.jpg', Buffer.from('thumbnail-bytes'));
    expect(db.update).toHaveBeenCalledWith(bookMetadata);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ coverSource: 'extracted', updatedAt: expect.any(Date) }));
  });

  it('downloadAndSaveCover no-ops on empty payloads and network failures', async () => {
    const { db } = makeDb();
    const service = new MetadataService(db as never, config as never, embedder as never);

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Buffer.alloc(0),
    }) as never;
    await service.downloadAndSaveCover('https://img.example/empty.png', 4);

    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();

    (global.fetch as jest.Mock).mockRejectedValue(new Error('timeout'));
    await expect(service.downloadAndSaveCover('https://img.example/fail.png', 4)).resolves.toBeUndefined();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('refreshCoverForBook returns false and avoids db writes when extractor reports no cover', async () => {
    const { db } = makeDb();
    const service = new MetadataService(db as never, config as never, embedder as never);
    mockExtractAndSaveCover.mockResolvedValue('');

    await expect(service.refreshCoverForBook(7, '/book.epub', 'epub')).resolves.toBe(false);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('extractAndSave triggers both metadata and cover extraction and propagates metadata errors', async () => {
    const { db } = makeDb();
    const service = new MetadataService(db as never, config as never, embedder as never);
    const metadataSpy = jest.spyOn(service as never, 'extractMetadata').mockRejectedValue(new Error('bad metadata'));
    const coverSpy = jest.spyOn(service as never, 'extractCover').mockResolvedValue(undefined);

    await expect(service.extractAndSave(15, '/books/a.pdf', 'pdf')).rejects.toThrow('bad metadata');
    expect(metadataSpy).toHaveBeenCalledWith(15, '/books/a.pdf', 'pdf');
    expect(coverSpy).toHaveBeenCalledWith(15, '/books/a.pdf', 'pdf');
  });

  it('extractMetadata(pdf) persists fallback title/year, page count, and extracted cover bytes', async () => {
    const { db, updateSet } = makeDb();
    const service = new MetadataService(db as never, config as never, embedder as never);
    const replaceAuthorsSpy = jest.spyOn(service, 'replaceAuthors').mockResolvedValue(undefined);
    const replaceGenresSpy = jest.spyOn(service, 'replaceGenres').mockResolvedValue(undefined);
    const savePdfCoverSpy = jest.spyOn(service as never, 'savePdfCover').mockResolvedValue(undefined);

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
      pageCount: 321,
      coverBuffer: Buffer.from('jpeg-bytes'),
    });
    mockParseBookFilename.mockReturnValue({ title: 'Title From Filename', publishedYear: 1999 });

    await (service as never).extractMetadata(22, '/tmp/book.pdf', 'pdf');

    expect(updateSet).toHaveBeenCalledWith({ pageCount: 321 });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Title From Filename',
        publishedYear: 1999,
        subtitle: 'Subtitle',
        description: 'Description',
        updatedAt: expect.any(Date),
      }),
    );
    expect(savePdfCoverSpy).toHaveBeenCalledWith(22, Buffer.from('jpeg-bytes'));
    expect(replaceAuthorsSpy).toHaveBeenCalledWith(22, [{ name: 'Author A', sortName: null }]);
    expect(replaceGenresSpy).toHaveBeenCalledWith(22, ['Fantasy']);
    expect(embedder.embedBook).toHaveBeenCalledWith(22);
  });

  it('extractMetadata(mobi) ignores malformed publishedDate values from providers', async () => {
    const { db, updateSet } = makeDb();
    const service = new MetadataService(db as never, config as never, embedder as never);
    jest.spyOn(service, 'replaceAuthors').mockResolvedValue(undefined);
    jest.spyOn(service, 'replaceGenres').mockResolvedValue(undefined);

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

    await (service as never).extractMetadata(33, '/tmp/book.mobi', 'mobi');

    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ publishedYear: null }));
  });

  it('replaceAuthors normalizes names and deduplicates case-insensitively before db writes', async () => {
    const { db, deleteWhere } = makeDb();
    const service = new MetadataService(db as never, config as never, embedder as never);
    const insertedAuthors: Array<{ name: string; sortName: string | null }> = [];
    const insertedBookAuthors: Array<{ bookId: number; authorId: number; displayOrder: number }> = [];

    db.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    }));
    db.insert.mockImplementation((table: unknown) => {
      if (table === authors) {
        return {
          values: (row: { name: string; sortName: string | null }) => {
            insertedAuthors.push(row);
            return { returning: async () => [{ id: 81 }] };
          },
        };
      }
      if (table === bookAuthors) {
        return {
          values: (row: { bookId: number; authorId: number; displayOrder: number }) => {
            insertedBookAuthors.push(row);
            return { onConflictDoNothing: async () => undefined };
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

    expect(db.delete).toHaveBeenCalledWith(bookAuthors);
    expect(deleteWhere).toHaveBeenCalledTimes(1);
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(insertedAuthors).toEqual([{ name: 'Alice', sortName: null }]);
    expect(insertedBookAuthors).toEqual([{ bookId: 5, authorId: 81, displayOrder: 0 }]);
  });

  it('replaceAuthors reuses existing authors and only inserts join rows', async () => {
    const { db } = makeDb();
    const service = new MetadataService(db as never, config as never, embedder as never);
    const insertedBookAuthors: Array<{ bookId: number; authorId: number; displayOrder: number }> = [];

    db.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ id: 9 }],
        }),
      }),
    }));
    db.insert.mockImplementation((table: unknown) => {
      if (table === bookAuthors) {
        return {
          values: (row: { bookId: number; authorId: number; displayOrder: number }) => {
            insertedBookAuthors.push(row);
            return { onConflictDoNothing: async () => undefined };
          },
        };
      }
      if (table === authors) {
        throw new Error('should not insert existing author');
      }
      throw new Error('unexpected table in insert');
    });

    await service.replaceAuthors(6, [{ name: 'Known Author', sortName: null }]);

    expect(insertedBookAuthors).toEqual([{ bookId: 6, authorId: 9, displayOrder: 0 }]);
  });
});
