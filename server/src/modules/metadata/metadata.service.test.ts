vi.mock('fs/promises', () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('./lib/cover', () => ({
  extractAndSaveCover: vi.fn(),
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

vi.mock('./lib/filename-parser', () => ({
  parseBookFilename: vi.fn(),
}));

vi.mock('./lib/fb2-parser', () => ({
  parseFb2File: vi.fn(),
}));

vi.mock('./lib/mobi-parser', () => ({
  parseMobiFile: vi.fn(),
}));

vi.mock('./lib/pdf-parser', () => ({
  parsePdfFile: vi.fn(),
}));

import { mkdir, writeFile } from 'fs/promises';

import { authors, bookAuthors, bookMetadata } from '../../db/schema';
import { extractAndSaveCover, generateThumbnail, imageExt } from './lib/cover';
import { parseBookFilename } from './lib/filename-parser';
import { parseMobiFile } from './lib/mobi-parser';
import { parsePdfFile } from './lib/pdf-parser';
import { MetadataService } from './metadata.service';

const mockMkdir = mkdir as MockedFunction<typeof mkdir>;
const mockWriteFile = writeFile as MockedFunction<typeof writeFile>;
const mockExtractAndSaveCover = extractAndSaveCover as MockedFunction<typeof extractAndSaveCover>;
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

  const db = {
    update: vi.fn().mockReturnValue({ set: updateSet }),
    delete: vi.fn().mockReturnValue(deleteBuilder),
    select: vi.fn().mockReturnValue({ from: selectFrom }),
    insert: vi.fn().mockReturnValue({ values: insertValues }),
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
  const config = { get: vi.fn().mockReturnValue('/books') };
  const embedder = { embedBook: vi.fn().mockResolvedValue(undefined) };

  beforeEach(() => {
    vi.resetAllMocks();

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
    const service = new MetadataService(
      db as never,
      config as never,
      { calculateAndSave: vi.fn().mockResolvedValue(undefined) } as never,
      embedder as never,
    );

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

  it('downloadAndSaveCover no-ops on empty payloads and network failures', async () => {
    const { db } = makeDb();
    const service = new MetadataService(
      db as never,
      config as never,
      { calculateAndSave: vi.fn().mockResolvedValue(undefined) } as never,
      embedder as never,
    );

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
    const service = new MetadataService(
      db as never,
      config as never,
      { calculateAndSave: vi.fn().mockResolvedValue(undefined) } as never,
      embedder as never,
    );
    mockExtractAndSaveCover.mockResolvedValue('');

    await expect(service.refreshCoverForBook(7, '/book.epub', 'epub')).resolves.toBe(false);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('extractAndSave triggers both metadata and cover extraction and propagates metadata errors', async () => {
    const { db } = makeDb();
    const service = new MetadataService(
      db as never,
      config as never,
      { calculateAndSave: vi.fn().mockResolvedValue(undefined) } as never,
      embedder as never,
    );
    const metadataSpy = vi.spyOn(service as never, 'extractMetadata').mockRejectedValue(new Error('bad metadata'));
    const coverSpy = vi.spyOn(service as never, 'extractCover').mockResolvedValue(undefined);

    await expect(service.extractAndSave(15, '/books/a.pdf', 'pdf')).rejects.toThrow('bad metadata');
    expect(metadataSpy).toHaveBeenCalledWith(15, '/books/a.pdf', 'pdf');
    expect(coverSpy).toHaveBeenCalledWith(15, '/books/a.pdf', 'pdf');
  });

  it('extractMetadata(pdf) persists fallback title/year, page count, and extracted cover bytes', async () => {
    const { db, updateSet } = makeDb();
    const service = new MetadataService(
      db as never,
      config as never,
      { calculateAndSave: vi.fn().mockResolvedValue(undefined) } as never,
      embedder as never,
    );
    const replaceAuthorsSpy = vi.spyOn(service, 'replaceAuthors').mockResolvedValue(undefined);
    const replaceGenresSpy = vi.spyOn(service, 'replaceGenres').mockResolvedValue(undefined);
    const savePdfCoverSpy = vi.spyOn(service as never, 'savePdfCover').mockResolvedValue(undefined);

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
    const service = new MetadataService(
      db as never,
      config as never,
      { calculateAndSave: vi.fn().mockResolvedValue(undefined) } as never,
      embedder as never,
    );
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

    await (service as never).extractMetadata(33, '/tmp/book.mobi', 'mobi');

    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ publishedYear: null }));
  });

  it('replaceAuthors normalizes names and deduplicates case-insensitively before db writes', async () => {
    const { db, deleteWhere } = makeDb();
    const service = new MetadataService(
      db as never,
      config as never,
      { calculateAndSave: vi.fn().mockResolvedValue(undefined) } as never,
      embedder as never,
    );
    const insertedAuthors: Array<{ name: string; sortName: string | null }> = [];
    const insertedBookAuthors: Array<{ bookId: number; authorId: number; displayOrder: number }> = [];

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
          values: (row: { name: string; sortName: string | null }) => {
            insertedAuthors.push(row);
            return { returning: () => Promise.resolve([{ id: 81 }]) };
          },
        };
      }
      if (table === bookAuthors) {
        return {
          values: (row: { bookId: number; authorId: number; displayOrder: number }) => {
            insertedBookAuthors.push(row);
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

    expect(db.delete).toHaveBeenCalledWith(bookAuthors);
    expect(deleteWhere).toHaveBeenCalledTimes(1);
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(insertedAuthors).toEqual([{ name: 'Alice', sortName: null }]);
    expect(insertedBookAuthors).toEqual([{ bookId: 5, authorId: 81, displayOrder: 0 }]);
  });

  it('replaceAuthors reuses existing authors and only inserts join rows', async () => {
    const { db } = makeDb();
    const service = new MetadataService(
      db as never,
      config as never,
      { calculateAndSave: vi.fn().mockResolvedValue(undefined) } as never,
      embedder as never,
    );
    const insertedBookAuthors: Array<{ bookId: number; authorId: number; displayOrder: number }> = [];

    db.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ id: 9 }]),
        }),
      }),
    }));
    db.insert.mockImplementation((table: unknown) => {
      if (table === bookAuthors) {
        return {
          values: (row: { bookId: number; authorId: number; displayOrder: number }) => {
            insertedBookAuthors.push(row);
            return { onConflictDoNothing: () => Promise.resolve(undefined) };
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
