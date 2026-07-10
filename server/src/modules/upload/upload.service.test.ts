vi.mock('fs/promises', async () => {
  const actual = await vi.importActual('fs/promises');
  return { ...actual, access: vi.fn(), stat: vi.fn() };
});

vi.mock('../scanner/lib/hash', () => ({ computeFileHash: vi.fn() }));
vi.mock('../scanner/lib/walk', () => ({ clampIno: vi.fn() }));

vi.mock('../metadata/lib/epub', () => ({ extractEpubMetadata: vi.fn() }));
vi.mock('../metadata/lib/cbz-metadata', () => ({ extractCbzMetadata: vi.fn(), extractCbrMetadata: vi.fn(), extractCb7Metadata: vi.fn() }));
vi.mock('../metadata/lib/mobi-parser', () => ({ parseMobiFile: vi.fn() }));
vi.mock('../metadata/lib/pdf-parser', () => ({ parsePdfFile: vi.fn() }));

import { access as fsAccess, stat } from 'fs/promises';
import { BadRequestException, ConflictException, ForbiddenException, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { extractEpubMetadata } from '../metadata/lib/epub';
import { extractCbzMetadata } from '../metadata/lib/cbz-metadata';
import { parseMobiFile } from '../metadata/lib/mobi-parser';
import { parsePdfFile } from '../metadata/lib/pdf-parser';
import { computeFileHash } from '../scanner/lib/hash';
import { clampIno } from '../scanner/lib/walk';

import { UploadService } from './upload.service';

const mockFsAccess = fsAccess as MockedFunction<typeof fsAccess>;
const mockStat = stat as MockedFunction<typeof stat>;
const mockExtractEpubMetadata = extractEpubMetadata as MockedFunction<typeof extractEpubMetadata>;
const mockExtractCbzMetadata = extractCbzMetadata as MockedFunction<typeof extractCbzMetadata>;
const mockParseMobiFile = parseMobiFile as MockedFunction<typeof parseMobiFile>;
const mockParsePdfFile = parsePdfFile as MockedFunction<typeof parsePdfFile>;
const mockComputeFileHash = computeFileHash as MockedFunction<typeof computeFileHash>;
const mockClampIno = clampIno as MockedFunction<typeof clampIno>;

function selectChain(rows: unknown[]) {
  const whereResult: PromiseLike<unknown[]> & { limit: vi.Mock } = {
    limit: vi.fn().mockResolvedValue(rows),
    then: (resolve) => Promise.resolve(resolve(rows)),
  };

  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue(whereResult),
    }),
  };
}

describe('UploadService', () => {
  const insertReturning = vi.fn();
  const insertValues = vi.fn();
  const updateSet = vi.fn();
  const updateWhere = vi.fn();

  const db = {
    select: vi.fn(),
    insert: vi.fn(() => ({ values: insertValues })),
    update: vi.fn(() => ({ set: updateSet })),
  };

  const appSettings = { getUploadPattern: vi.fn(), getUploadPatternBookPerFolder: vi.fn(), isCrossPlatformPathSanitizationEnabled: vi.fn() };
  const libraryService = { verifyUserAccess: vi.fn() };
  const validator = {
    sanitizeFilename: vi.fn(),
    validateFormat: vi.fn(),
  };
  const storage = {
    streamToTemp: vi.fn(),
    moveToPath: vi.fn(),
    cleanup: vi.fn(),
  };
  const processor = {
    createBookRecord: vi.fn(),
    processNewBookImportAsync: vi.fn(),
    extractMetadataAsync: vi.fn(),
    extractAudioDurationAsync: vi.fn(),
  };

  const user = { id: 7, isSuperuser: false, permissions: [] } as any;

  const moduleRef = { get: vi.fn().mockReturnValue(null) };

  let service: UploadService;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    service = new UploadService(
      db as any,
      appSettings as any,
      libraryService as any,
      validator as any,
      storage as any,
      processor as any,
      moduleRef as any,
    );

    validator.sanitizeFilename.mockReturnValue('book.epub');
    validator.validateFormat.mockReturnValue('epub');
    storage.streamToTemp.mockResolvedValue({ tempPath: '/tmp/upload.bin', sizeBytes: 456 });
    storage.moveToPath.mockResolvedValue(undefined);
    storage.cleanup.mockResolvedValue(undefined);
    processor.createBookRecord.mockResolvedValue({ bookId: 99, created: true });
    libraryService.verifyUserAccess.mockResolvedValue(undefined);
    appSettings.getUploadPattern.mockResolvedValue(null);
    appSettings.getUploadPatternBookPerFolder.mockResolvedValue(null);
    appSettings.isCrossPlatformPathSanitizationEnabled.mockResolvedValue(false);
    mockFsAccess.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    mockExtractEpubMetadata.mockResolvedValue(null);

    // addFileToBook defaults
    insertValues.mockReturnValue({ returning: insertReturning });
    insertReturning.mockResolvedValue([
      {
        id: 55,
        format: 'epub',
        role: 'content',
        sizeBytes: 456,
        absolutePath: '/library/Book/book.epub',
        createdAt: new Date('2025-01-01'),
        durationSeconds: null,
      },
    ]);
    updateSet.mockReturnValue({ where: updateWhere });
    updateWhere.mockResolvedValue(undefined);
    mockComputeFileHash.mockResolvedValue('hash-abc');
    mockClampIno.mockReturnValue(12345);
    mockStat.mockResolvedValue({ ino: 12345n, mtime: new Date('2025-01-01') } as any);
  });

  it('uploads successfully and processes a new-book import after the record is created', async () => {
    db.select
      .mockReturnValueOnce(selectChain([{ id: 1, allowedFormats: ['epub'], fileNamingPattern: '{authors:first}/{title}.{extension}' }]))
      .mockReturnValueOnce(selectChain([{ id: 2, libraryId: 1, path: '/library' }]));

    mockExtractEpubMetadata.mockResolvedValue({
      title: 'Dune',
      subtitle: null,
      publisher: null,
      publishedYear: null,
      language: null,
      seriesName: null,
      seriesIndex: null,
      isbn13: null,
      authors: [{ name: 'Frank Herbert' }],
      tags: [],
      description: null,
      isbn10: null,
    });

    const result = await service.upload(1, 2, 'raw.epub', {} as any, user);

    expect(result).toEqual({ bookId: 99, filename: 'Dune.epub', format: 'epub', sizeBytes: 456 });
    expect(storage.moveToPath).toHaveBeenCalledWith('/tmp/upload.bin', '/library/Frank Herbert/Dune.epub');
    expect(processor.createBookRecord).toHaveBeenCalledWith(
      1,
      2,
      '/library/Frank Herbert',
      '/library/Frank Herbert/Dune.epub',
      'Frank Herbert/Dune.epub',
      'epub',
      456,
    );
    expect(processor.processNewBookImportAsync).toHaveBeenCalledWith(99, 1, '/library/Frank Herbert/Dune.epub', 'epub');
  });

  it('only extracts metadata when an upload adds a file to an existing book', async () => {
    processor.createBookRecord.mockResolvedValue({ bookId: 99, created: false });
    db.select
      .mockReturnValueOnce(selectChain([{ id: 1, allowedFormats: ['epub'], fileNamingPattern: null }]))
      .mockReturnValueOnce(selectChain([{ id: 2, libraryId: 1, path: '/library' }]));

    await service.upload(1, 2, 'raw.epub', {} as any, user);

    expect(processor.extractMetadataAsync).toHaveBeenCalledWith(99, '/library/book/book.epub', 'epub');
    expect(processor.processNewBookImportAsync).not.toHaveBeenCalled();
  });

  it('sanitizes generated destination path tokens when cross-platform mode is enabled', async () => {
    appSettings.isCrossPlatformPathSanitizationEnabled.mockResolvedValue(true);
    db.select
      .mockReturnValueOnce(selectChain([{ id: 1, allowedFormats: ['epub'], fileNamingPattern: '{authors:first}/{title}.{extension}' }]))
      .mockReturnValueOnce(selectChain([{ id: 2, libraryId: 1, path: '/library' }]));

    mockExtractEpubMetadata.mockResolvedValue({
      title: 'AUX',
      subtitle: null,
      publisher: null,
      publishedYear: null,
      language: null,
      seriesName: null,
      seriesIndex: null,
      isbn13: null,
      authors: [{ name: 'CON' }],
      tags: [],
      description: null,
      isbn10: null,
    });

    const result = await service.upload(1, 2, 'raw.epub', {} as any, user);

    expect(result).toEqual({ bookId: 99, filename: 'AUX_.epub', format: 'epub', sizeBytes: 456 });
    expect(storage.moveToPath).toHaveBeenCalledWith('/tmp/upload.bin', '/library/CON_/AUX_.epub');
  });

  it('falls back to stem folder when no naming pattern is configured', async () => {
    db.select
      .mockReturnValueOnce(selectChain([{ id: 1, allowedFormats: ['epub'], fileNamingPattern: null }]))
      .mockReturnValueOnce(selectChain([{ id: 2, libraryId: 1, path: '/library' }]));

    const result = await service.upload(1, 2, 'raw.epub', {} as any, user);

    expect(result.filename).toBe('book.epub');
    expect(processor.createBookRecord).toHaveBeenCalledWith(1, 2, '/library/book', '/library/book/book.epub', 'book/book.epub', 'epub', 456);
  });

  it('falls back to stem folder when metadata token extraction fails', async () => {
    db.select
      .mockReturnValueOnce(selectChain([{ id: 1, allowedFormats: ['epub'], fileNamingPattern: '{title}' }]))
      .mockReturnValueOnce(selectChain([{ id: 2, libraryId: 1, path: '/library' }]));
    mockExtractEpubMetadata.mockRejectedValue(new Error('metadata parser broke'));

    const result = await service.upload(1, 2, 'raw.epub', {} as any, user);

    expect(result).toEqual({ bookId: 99, filename: 'book.epub', format: 'epub', sizeBytes: 456 });
    expect(storage.moveToPath).toHaveBeenCalledWith('/tmp/upload.bin', '/library/book/book.epub');
  });

  it('throws ConflictException when destination already exists and cleans temp path', async () => {
    db.select
      .mockReturnValueOnce(selectChain([{ id: 1, allowedFormats: ['epub'], fileNamingPattern: null }]))
      .mockReturnValueOnce(selectChain([{ id: 2, libraryId: 1, path: '/library' }]));
    mockFsAccess.mockResolvedValue(undefined);

    await expect(service.upload(1, 2, 'raw.epub', {} as any, user)).rejects.toBeInstanceOf(ConflictException);
    expect(storage.cleanup).toHaveBeenCalledWith('/tmp/upload.bin');
    expect(storage.cleanup).not.toHaveBeenCalledWith('/library/book/book.epub');
    expect(storage.moveToPath).not.toHaveBeenCalled();
  });

  it('cleans up both paths when move fails', async () => {
    db.select
      .mockReturnValueOnce(selectChain([{ id: 1, allowedFormats: ['epub'], fileNamingPattern: null }]))
      .mockReturnValueOnce(selectChain([{ id: 2, libraryId: 1, path: '/library' }]));
    storage.moveToPath.mockRejectedValue(new Error('disk full'));

    await expect(service.upload(1, 2, 'raw.epub', {} as any, user)).rejects.toThrow('disk full');
    expect(storage.cleanup).toHaveBeenCalledWith('/tmp/upload.bin');
    expect(storage.cleanup).toHaveBeenCalledWith('/library/book/book.epub');
  });

  it('cleans destination when DB write fails after move', async () => {
    db.select
      .mockReturnValueOnce(selectChain([{ id: 1, allowedFormats: ['epub'], fileNamingPattern: null }]))
      .mockReturnValueOnce(selectChain([{ id: 2, libraryId: 1, path: '/library' }]));
    processor.createBookRecord.mockRejectedValue(new Error('insert failed'));

    await expect(service.upload(1, 2, 'raw.epub', {} as any, user)).rejects.toThrow('insert failed');
    expect(storage.cleanup).toHaveBeenCalledWith('/tmp/upload.bin');
    expect(storage.cleanup).toHaveBeenCalledWith('/library/book/book.epub');
  });

  it('propagates access errors other than ENOENT', async () => {
    db.select
      .mockReturnValueOnce(selectChain([{ id: 1, allowedFormats: ['epub'], fileNamingPattern: null }]))
      .mockReturnValueOnce(selectChain([{ id: 2, libraryId: 1, path: '/library' }]));
    mockFsAccess.mockRejectedValue(Object.assign(new Error('permission denied'), { code: 'EACCES' }));

    await expect(service.upload(1, 2, 'raw.epub', {} as any, user)).rejects.toThrow('permission denied');
    expect(storage.moveToPath).not.toHaveBeenCalled();
  });

  it('rejects folder IDs that do not belong to the selected library', async () => {
    db.select
      .mockReturnValueOnce(selectChain([{ id: 1, allowedFormats: ['epub'], fileNamingPattern: null }]))
      .mockReturnValueOnce(selectChain([{ id: 2, libraryId: 999, path: '/wrong' }]));

    await expect(service.upload(1, 2, 'raw.epub', {} as any, user)).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.streamToTemp).not.toHaveBeenCalled();
  });

  it('chooses a deterministic default folder by smallest ID', async () => {
    db.select.mockReturnValueOnce(selectChain([{ id: 1, allowedFormats: ['epub'], fileNamingPattern: null }])).mockReturnValueOnce(
      selectChain([
        { id: 20, libraryId: 1, path: '/folder-b' },
        { id: 2, libraryId: 1, path: '/folder-a' },
      ]),
    );

    await service.upload(1, undefined, 'raw.epub', {} as any, user);

    expect(processor.createBookRecord).toHaveBeenCalledWith(1, 2, '/folder-a/book', '/folder-a/book/book.epub', 'book/book.epub', 'epub', 456);
  });

  it('rejects uploads when no default folder exists for the library', async () => {
    db.select.mockReturnValueOnce(selectChain([{ id: 1, allowedFormats: ['epub'], fileNamingPattern: null }])).mockReturnValueOnce(selectChain([]));

    await expect(service.upload(1, undefined, 'raw.epub', {} as any, user)).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.streamToTemp).not.toHaveBeenCalled();
  });

  it('book_per_file with pattern uses resolveDownloadFilename for flat layout', async () => {
    db.select
      .mockReturnValueOnce(
        selectChain([{ id: 1, allowedFormats: ['epub'], fileNamingPattern: '{title}.{extension}', organizationMode: 'book_per_file' }]),
      )
      .mockReturnValueOnce(selectChain([{ id: 2, libraryId: 1, path: '/library' }]));

    mockExtractEpubMetadata.mockResolvedValue({
      title: 'Dune',
      subtitle: null,
      publisher: null,
      publishedYear: null,
      language: null,
      seriesName: null,
      seriesIndex: null,
      isbn13: null,
      authors: [{ name: 'Frank Herbert' }],
      tags: [],
      description: null,
      isbn10: null,
    });

    const result = await service.upload(1, 2, 'raw.epub', {} as any, user);

    expect(result).toEqual({ bookId: 99, filename: 'Dune.epub', format: 'epub', sizeBytes: 456 });
    expect(storage.moveToPath).toHaveBeenCalledWith('/tmp/upload.bin', '/library/Dune.epub');
    expect(processor.createBookRecord).toHaveBeenCalledWith(1, 2, '/library/Dune.epub', '/library/Dune.epub', 'Dune.epub', 'epub', 456);
  });

  it('book_per_file without pattern uses filename directly', async () => {
    db.select
      .mockReturnValueOnce(selectChain([{ id: 1, allowedFormats: ['epub'], fileNamingPattern: null, organizationMode: 'book_per_file' }]))
      .mockReturnValueOnce(selectChain([{ id: 2, libraryId: 1, path: '/library' }]));

    const result = await service.upload(1, 2, 'raw.epub', {} as any, user);

    expect(result).toEqual({ bookId: 99, filename: 'book.epub', format: 'epub', sizeBytes: 456 });
    expect(storage.moveToPath).toHaveBeenCalledWith('/tmp/upload.bin', '/library/book.epub');
    expect(processor.createBookRecord).toHaveBeenCalledWith(1, 2, '/library/book.epub', '/library/book.epub', 'book.epub', 'epub', 456);
  });

  it('book_per_file falls back to filename when pattern resolves to null', async () => {
    db.select
      .mockReturnValueOnce(selectChain([{ id: 1, allowedFormats: ['epub'], fileNamingPattern: '{title}', organizationMode: 'book_per_file' }]))
      .mockReturnValueOnce(selectChain([{ id: 2, libraryId: 1, path: '/library' }]));

    mockExtractEpubMetadata.mockResolvedValue(null);

    const result = await service.upload(1, 2, 'raw.epub', {} as any, user);

    expect(result).toEqual({ bookId: 99, filename: 'book.epub', format: 'epub', sizeBytes: 456 });
    expect(storage.moveToPath).toHaveBeenCalledWith('/tmp/upload.bin', '/library/book.epub');
    expect(processor.createBookRecord).toHaveBeenCalledWith(1, 2, '/library/book.epub', '/library/book.epub', 'book.epub', 'epub', 456);
  });

  it('book_per_file throws ConflictException when destination exists', async () => {
    db.select
      .mockReturnValueOnce(selectChain([{ id: 1, allowedFormats: ['epub'], fileNamingPattern: null, organizationMode: 'book_per_file' }]))
      .mockReturnValueOnce(selectChain([{ id: 2, libraryId: 1, path: '/library' }]));
    mockFsAccess.mockResolvedValue(undefined);

    await expect(service.upload(1, 2, 'raw.epub', {} as any, user)).rejects.toBeInstanceOf(ConflictException);
    expect(storage.cleanup).toHaveBeenCalledWith('/tmp/upload.bin');
    expect(storage.moveToPath).not.toHaveBeenCalled();
  });

  it('mobi metadata populates tokens', async () => {
    validator.validateFormat.mockReturnValue('mobi');
    validator.sanitizeFilename.mockReturnValue('book.mobi');
    db.select
      .mockReturnValueOnce(selectChain([{ id: 1, allowedFormats: ['mobi'], fileNamingPattern: '{authors:first}/{title}.{extension}' }]))
      .mockReturnValueOnce(selectChain([{ id: 2, libraryId: 1, path: '/library' }]));

    mockParseMobiFile.mockResolvedValue({
      title: 'The Stand',
      authors: ['Stephen King'],
      publisher: 'Doubleday',
      isbn: '9780385121682',
      publishedDate: '1978-10-03',
      language: 'en',
      description: null,
      tags: [],
      coverRecordIndex: null,
      recordOffsets: [],
    });

    const result = await service.upload(1, 2, 'raw.mobi', {} as any, user);

    expect(result).toEqual({ bookId: 99, filename: 'The Stand.mobi', format: 'mobi', sizeBytes: 456 });
    expect(storage.moveToPath).toHaveBeenCalledWith('/tmp/upload.bin', '/library/Stephen King/The Stand.mobi');
  });

  it('pdf metadata populates tokens', async () => {
    validator.validateFormat.mockReturnValue('pdf');
    validator.sanitizeFilename.mockReturnValue('doc.pdf');
    db.select
      .mockReturnValueOnce(selectChain([{ id: 1, allowedFormats: ['pdf'], fileNamingPattern: '{title}.{extension}' }]))
      .mockReturnValueOnce(selectChain([{ id: 2, libraryId: 1, path: '/library' }]));

    mockParsePdfFile.mockResolvedValue({
      title: 'Research Paper',
      authors: [{ name: 'Jane Doe', sortName: null }],
      publisher: 'Academic Press',
      subtitle: null,
      description: null,
      publishedYear: null,
      language: null,
      genres: [],
      tags: [],
      isbn10: null,
      isbn13: null,
      seriesName: null,
      seriesIndex: null,
      rating: null,
      pageCount: null,
      googleBooksId: null,
      goodreadsId: null,
      amazonId: null,
      hardcoverId: null,
      openLibraryId: null,
      itunesId: null,
    });

    const result = await service.upload(1, 2, 'raw.pdf', {} as any, user);

    expect(result).toEqual({ bookId: 99, filename: 'Research Paper.pdf', format: 'pdf', sizeBytes: 456 });
    expect(storage.moveToPath).toHaveBeenCalledWith('/tmp/upload.bin', '/library/Research Paper.pdf');
    expect(mockParsePdfFile).toHaveBeenCalledWith(
      '/tmp/upload.bin',
      expect.objectContaining({
        extractCover: false,
        onWarning: expect.any(Function),
      }),
    );
  });

  it('cbz metadata populates tokens', async () => {
    validator.validateFormat.mockReturnValue('cbz');
    validator.sanitizeFilename.mockReturnValue('comic.cbz');
    db.select
      .mockReturnValueOnce(selectChain([{ id: 1, allowedFormats: ['cbz'], fileNamingPattern: '{series}/{title}.{extension}' }]))
      .mockReturnValueOnce(selectChain([{ id: 2, libraryId: 1, path: '/library' }]));

    mockExtractCbzMetadata.mockResolvedValue({
      title: 'Issue 1',
      seriesName: 'Batman',
      seriesIndex: 1,
      authors: [{ name: 'Bob Kane', sortName: null }],
      subtitle: null,
      description: null,
      publisher: null,
      publishedYear: null,
      language: null,
      pageCount: null,
      rating: null,
      isbn10: null,
      isbn13: null,
      genres: [],
      tags: [],
      googleBooksId: null,
      goodreadsId: null,
      amazonId: null,
      hardcoverId: null,
      openLibraryId: null,
      itunesId: null,
      comicMetadata: null,
    });

    const result = await service.upload(1, 2, 'raw.cbz', {} as any, user);

    expect(result).toEqual({ bookId: 99, filename: 'Issue 1.cbz', format: 'cbz', sizeBytes: 456 });
    expect(storage.moveToPath).toHaveBeenCalledWith('/tmp/upload.bin', '/library/Batman/Issue 1.cbz');
  });

  it('unsupported format returns base tokens only', async () => {
    validator.validateFormat.mockReturnValue('fb2');
    validator.sanitizeFilename.mockReturnValue('book.fb2');
    db.select
      .mockReturnValueOnce(selectChain([{ id: 1, allowedFormats: ['fb2'], fileNamingPattern: '{title}' }]))
      .mockReturnValueOnce(selectChain([{ id: 2, libraryId: 1, path: '/library' }]));

    const result = await service.upload(1, 2, 'raw.fb2', {} as any, user);

    expect(result).toEqual({ bookId: 99, filename: 'book.fb2', format: 'fb2', sizeBytes: 456 });
    expect(storage.moveToPath).toHaveBeenCalledWith('/tmp/upload.bin', '/library/book/book.fb2');
  });

  it('series index formatting - whole number zero-padded', async () => {
    db.select
      .mockReturnValueOnce(selectChain([{ id: 1, allowedFormats: ['epub'], fileNamingPattern: '{series} {seriesIndex}/{title}.{extension}' }]))
      .mockReturnValueOnce(selectChain([{ id: 2, libraryId: 1, path: '/library' }]));

    mockExtractEpubMetadata.mockResolvedValue({
      title: 'Book Three',
      subtitle: null,
      publisher: null,
      publishedYear: null,
      language: null,
      seriesName: 'Trilogy',
      seriesIndex: 3,
      isbn13: null,
      authors: [{ name: 'Author' }],
      tags: [],
      description: null,
      isbn10: null,
    });

    const result = await service.upload(1, 2, 'raw.epub', {} as any, user);

    expect(result).toEqual({ bookId: 99, filename: 'Book Three.epub', format: 'epub', sizeBytes: 456 });
    expect(storage.moveToPath).toHaveBeenCalledWith('/tmp/upload.bin', '/library/Trilogy 03/Book Three.epub');
  });

  it('series index formatting - decimal preserved', async () => {
    db.select
      .mockReturnValueOnce(selectChain([{ id: 1, allowedFormats: ['epub'], fileNamingPattern: '{series} {seriesIndex}/{title}.{extension}' }]))
      .mockReturnValueOnce(selectChain([{ id: 2, libraryId: 1, path: '/library' }]));

    mockExtractEpubMetadata.mockResolvedValue({
      title: 'Book Three',
      subtitle: null,
      publisher: null,
      publishedYear: null,
      language: null,
      seriesName: 'Trilogy',
      seriesIndex: 1.5,
      isbn13: null,
      authors: [{ name: 'Author' }],
      tags: [],
      description: null,
      isbn10: null,
    });

    const result = await service.upload(1, 2, 'raw.epub', {} as any, user);

    expect(result).toEqual({ bookId: 99, filename: 'Book Three.epub', format: 'epub', sizeBytes: 456 });
    expect(storage.moveToPath).toHaveBeenCalledWith('/tmp/upload.bin', '/library/Trilogy 01.5/Book Three.epub');
  });

  it('mobi parser throws - logs warning and returns base tokens', async () => {
    validator.validateFormat.mockReturnValue('mobi');
    validator.sanitizeFilename.mockReturnValue('book.mobi');
    db.select
      .mockReturnValueOnce(selectChain([{ id: 1, allowedFormats: ['mobi'], fileNamingPattern: '{title}' }]))
      .mockReturnValueOnce(selectChain([{ id: 2, libraryId: 1, path: '/library' }]));

    mockParseMobiFile.mockRejectedValue(new Error('mobi parse error'));

    const result = await service.upload(1, 2, 'raw.mobi', {} as any, user);

    expect(result).toEqual({ bookId: 99, filename: 'book.mobi', format: 'mobi', sizeBytes: 456 });
    expect(storage.moveToPath).toHaveBeenCalledWith('/tmp/upload.bin', '/library/book/book.mobi');
  });

  it('throws NotFoundException when library does not exist', async () => {
    db.select.mockReturnValueOnce(selectChain([]));

    await expect(service.upload(999, undefined, 'raw.epub', {} as any, user)).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.streamToTemp).not.toHaveBeenCalled();
  });

  it('throws when user has no access to library', async () => {
    db.select.mockReturnValueOnce(selectChain([{ id: 1, allowedFormats: ['epub'], fileNamingPattern: null }]));
    libraryService.verifyUserAccess.mockRejectedValue(new ForbiddenException('No access'));

    await expect(service.upload(1, undefined, 'raw.epub', {} as any, user)).rejects.toBeInstanceOf(ForbiddenException);
    expect(storage.streamToTemp).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when folder does not exist', async () => {
    db.select.mockReturnValueOnce(selectChain([{ id: 1, allowedFormats: ['epub'], fileNamingPattern: null }])).mockReturnValueOnce(selectChain([]));

    await expect(service.upload(1, 999, 'raw.epub', {} as any, user)).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.streamToTemp).not.toHaveBeenCalled();
  });

  it('library pattern takes precedence over global upload pattern', async () => {
    db.select
      .mockReturnValueOnce(selectChain([{ id: 1, allowedFormats: ['epub'], fileNamingPattern: '{title}.{extension}' }]))
      .mockReturnValueOnce(selectChain([{ id: 2, libraryId: 1, path: '/library' }]));

    appSettings.getUploadPattern.mockResolvedValue('{authors:first}/{title}.{extension}');

    mockExtractEpubMetadata.mockResolvedValue({
      title: 'MyBook',
      subtitle: null,
      publisher: null,
      publishedYear: null,
      language: null,
      seriesName: null,
      seriesIndex: null,
      isbn13: null,
      authors: [{ name: 'AuthorX' }],
      tags: [],
      description: null,
      isbn10: null,
    });

    const result = await service.upload(1, 2, 'raw.epub', {} as any, user);

    expect(result).toEqual({ bookId: 99, filename: 'MyBook.epub', format: 'epub', sizeBytes: 456 });
    expect(storage.moveToPath).toHaveBeenCalledWith('/tmp/upload.bin', '/library/MyBook.epub');
    expect(appSettings.getUploadPattern).not.toHaveBeenCalled();
    expect(appSettings.getUploadPatternBookPerFolder).not.toHaveBeenCalled();
  });

  it('book_per_file global pattern used when library pattern is null', async () => {
    db.select
      .mockReturnValueOnce(selectChain([{ id: 1, allowedFormats: ['epub'], fileNamingPattern: null, organizationMode: 'book_per_file' }]))
      .mockReturnValueOnce(selectChain([{ id: 2, libraryId: 1, path: '/library' }]));

    appSettings.getUploadPattern.mockResolvedValue('{title}.{extension}');

    mockExtractEpubMetadata.mockResolvedValue({
      title: 'GlobalBook',
      subtitle: null,
      publisher: null,
      publishedYear: null,
      language: null,
      seriesName: null,
      seriesIndex: null,
      isbn13: null,
      authors: [],
      tags: [],
      description: null,
      isbn10: null,
    });

    const result = await service.upload(1, 2, 'raw.epub', {} as any, user);

    expect(result).toEqual({ bookId: 99, filename: 'GlobalBook.epub', format: 'epub', sizeBytes: 456 });
    expect(storage.moveToPath).toHaveBeenCalledWith('/tmp/upload.bin', '/library/GlobalBook.epub');
    expect(appSettings.getUploadPattern).toHaveBeenCalled();
    expect(appSettings.getUploadPatternBookPerFolder).not.toHaveBeenCalled();
  });

  it('book_per_folder global pattern used when library pattern is null', async () => {
    db.select
      .mockReturnValueOnce(selectChain([{ id: 1, allowedFormats: ['epub'], fileNamingPattern: null, organizationMode: 'book_per_folder' }]))
      .mockReturnValueOnce(selectChain([{ id: 2, libraryId: 1, path: '/library' }]));

    appSettings.getUploadPatternBookPerFolder.mockResolvedValue('{title}/');

    mockExtractEpubMetadata.mockResolvedValue({
      title: 'FolderBook',
      subtitle: null,
      publisher: null,
      publishedYear: null,
      language: null,
      seriesName: null,
      seriesIndex: null,
      isbn13: null,
      authors: [],
      tags: [],
      description: null,
      isbn10: null,
    });

    await service.upload(1, 2, 'raw.epub', {} as any, user);

    expect(storage.moveToPath).toHaveBeenCalledWith('/tmp/upload.bin', '/library/FolderBook/book.epub');
    expect(appSettings.getUploadPatternBookPerFolder).toHaveBeenCalled();
    expect(appSettings.getUploadPattern).not.toHaveBeenCalled();
  });

  it('book_per_folder library pattern still wins over folder-mode global pattern', async () => {
    db.select
      .mockReturnValueOnce(
        selectChain([{ id: 1, allowedFormats: ['epub'], fileNamingPattern: '{title}/{title}.{extension}', organizationMode: 'book_per_folder' }]),
      )
      .mockReturnValueOnce(selectChain([{ id: 2, libraryId: 1, path: '/library' }]));

    appSettings.getUploadPatternBookPerFolder.mockResolvedValue('{series}/{title}/');

    mockExtractEpubMetadata.mockResolvedValue({
      title: 'Dune',
      subtitle: null,
      publisher: null,
      publishedYear: null,
      language: null,
      seriesName: 'Dune Chronicles',
      seriesIndex: 1,
      isbn13: null,
      authors: [{ name: 'Frank Herbert' }],
      tags: [],
      description: null,
      isbn10: null,
    });

    await service.upload(1, 2, 'raw.epub', {} as any, user);

    expect(storage.moveToPath).toHaveBeenCalledWith('/tmp/upload.bin', '/library/Dune/Dune.epub');
    expect(appSettings.getUploadPatternBookPerFolder).not.toHaveBeenCalled();
    expect(appSettings.getUploadPattern).not.toHaveBeenCalled();
  });

  it('pattern resolves to null falls back to stem-folder layout', async () => {
    db.select
      .mockReturnValueOnce(selectChain([{ id: 1, allowedFormats: ['epub'], fileNamingPattern: '{title}' }]))
      .mockReturnValueOnce(selectChain([{ id: 2, libraryId: 1, path: '/library' }]));

    mockExtractEpubMetadata.mockResolvedValue(null);

    const result = await service.upload(1, 2, 'raw.epub', {} as any, user);

    expect(result).toEqual({ bookId: 99, filename: 'book.epub', format: 'epub', sizeBytes: 456 });
    expect(storage.moveToPath).toHaveBeenCalledWith('/tmp/upload.bin', '/library/book/book.epub');
  });

  describe('addFileToBook', () => {
    function makeBookRow(overrides: Record<string, unknown> = {}) {
      return {
        id: 10,
        folderPath: '/library/Book Title',
        libraryId: 1,
        libraryFolderId: 2,
        primaryFileId: 99,
        status: 'present',
        allowedFormats: [] as string[],
        organizationMode: 'book_per_folder',
        libraryFolderPath: '/library',
        ...overrides,
      };
    }

    function selectJoinChain(rows: unknown[]) {
      const limitMock = vi.fn().mockResolvedValue(rows);
      const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
      const joinMock2 = vi.fn().mockReturnValue({ where: whereMock });
      const joinMock1 = vi.fn().mockReturnValue({ innerJoin: joinMock2, where: whereMock });
      return {
        from: vi.fn().mockReturnValue({ innerJoin: joinMock1 }),
      };
    }

    function noHashConflict() {
      return selectChain([]);
    }

    it('adds a file successfully to an existing book with a primary file', async () => {
      db.select.mockReturnValueOnce(selectJoinChain([makeBookRow()])).mockReturnValueOnce(noHashConflict());

      const result = await service.addFileToBook(10, 'book.epub', {} as any, user);

      expect(storage.streamToTemp).toHaveBeenCalled();
      expect(storage.moveToPath).toHaveBeenCalledWith('/tmp/upload.bin', '/library/Book Title/book.epub');
      expect(db.insert).toHaveBeenCalled();
      expect(result.filename).toBe('book.epub');
      expect(result.format).toBe('epub');
      expect(result.bookStatus).toBe('present');
      expect(result.role).toBe('content');
    });

    it('kicks off per-file audio duration extraction for an added audio file', async () => {
      validator.sanitizeFilename.mockReturnValue('chapter-02.mp3');
      validator.validateFormat.mockReturnValue('mp3');
      db.select.mockReturnValueOnce(selectJoinChain([makeBookRow()])).mockReturnValueOnce(noHashConflict());

      await service.addFileToBook(10, 'chapter-02.mp3', {} as any, user);

      expect(processor.extractAudioDurationAsync).toHaveBeenCalledWith(10, '/library/Book Title/chapter-02.mp3', 'mp3');
    });

    it('delegates duration extraction to the processor regardless of format (processor gates on audio)', async () => {
      db.select.mockReturnValueOnce(selectJoinChain([makeBookRow()])).mockReturnValueOnce(noHashConflict());

      await service.addFileToBook(10, 'book.epub', {} as any, user);

      expect(processor.extractAudioDurationAsync).toHaveBeenCalledWith(10, '/library/Book Title/book.epub', 'epub');
    });

    it('promotes new file to primary when book has no primary file', async () => {
      db.select.mockReturnValueOnce(selectJoinChain([makeBookRow({ primaryFileId: null })])).mockReturnValueOnce(noHashConflict());

      const result = await service.addFileToBook(10, 'book.epub', {} as any, user);

      expect(db.update).toHaveBeenCalled();
      expect(updateWhere).toHaveBeenCalled();
      expect(result.role).toBe('primary');
    });

    it('updates book status from missing to present and promotes primary when null', async () => {
      db.select.mockReturnValueOnce(selectJoinChain([makeBookRow({ primaryFileId: null, status: 'missing' })])).mockReturnValueOnce(noHashConflict());

      const result = await service.addFileToBook(10, 'book.epub', {} as any, user);

      expect(db.update).toHaveBeenCalled();
      expect(result.bookStatus).toBe('present');
      expect(result.role).toBe('primary');
    });

    it('updates only status when book is missing but already has a primary file', async () => {
      db.select.mockReturnValueOnce(selectJoinChain([makeBookRow({ primaryFileId: 42, status: 'missing' })])).mockReturnValueOnce(noHashConflict());

      const result = await service.addFileToBook(10, 'book.epub', {} as any, user);

      expect(db.update).toHaveBeenCalled();
      expect(result.bookStatus).toBe('present');
      expect(result.role).toBe('content');
    });

    it('does not call db.update when book is present and already has a primary', async () => {
      db.select.mockReturnValueOnce(selectJoinChain([makeBookRow()])).mockReturnValueOnce(noHashConflict());

      await service.addFileToBook(10, 'book.epub', {} as any, user);

      expect(db.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when book does not exist', async () => {
      db.select.mockReturnValueOnce(selectJoinChain([]));

      await expect(service.addFileToBook(999, 'book.epub', {} as any, user)).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.streamToTemp).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when user has no library access', async () => {
      db.select.mockReturnValueOnce(selectJoinChain([makeBookRow()]));
      libraryService.verifyUserAccess.mockRejectedValue(new ForbiddenException('No access'));

      await expect(service.addFileToBook(10, 'book.epub', {} as any, user)).rejects.toBeInstanceOf(ForbiddenException);
      expect(storage.streamToTemp).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for book_per_file organization mode', async () => {
      db.select.mockReturnValueOnce(selectJoinChain([makeBookRow({ organizationMode: 'book_per_file' })]));

      await expect(service.addFileToBook(10, 'book.epub', {} as any, user)).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.streamToTemp).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when format validation fails', async () => {
      db.select.mockReturnValueOnce(selectJoinChain([makeBookRow()]));
      validator.validateFormat.mockImplementation(() => {
        throw new BadRequestException('Unsupported format');
      });

      await expect(service.addFileToBook(10, 'bad.xyz', {} as any, user)).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.streamToTemp).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for empty file and cleans up temp', async () => {
      db.select.mockReturnValueOnce(selectJoinChain([makeBookRow()]));
      storage.streamToTemp.mockResolvedValue({ tempPath: '/tmp/upload.bin', sizeBytes: 0 });

      await expect(service.addFileToBook(10, 'book.epub', {} as any, user)).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.cleanup).toHaveBeenCalledWith('/tmp/upload.bin');
    });

    it('throws ConflictException for duplicate content hash and cleans up temp', async () => {
      db.select.mockReturnValueOnce(selectJoinChain([makeBookRow()])).mockReturnValueOnce(selectChain([{ id: 77 }]));

      await expect(service.addFileToBook(10, 'book.epub', {} as any, user)).rejects.toBeInstanceOf(ConflictException);
      expect(storage.cleanup).toHaveBeenCalledWith('/tmp/upload.bin');
      expect(storage.moveToPath).not.toHaveBeenCalled();
    });

    it('throws ConflictException when destination file already exists and cleans up temp', async () => {
      db.select.mockReturnValueOnce(selectJoinChain([makeBookRow()])).mockReturnValueOnce(noHashConflict());
      mockFsAccess.mockResolvedValue(undefined);

      await expect(service.addFileToBook(10, 'book.epub', {} as any, user)).rejects.toBeInstanceOf(ConflictException);
      expect(storage.cleanup).toHaveBeenCalledWith('/tmp/upload.bin');
      expect(storage.moveToPath).not.toHaveBeenCalled();
    });

    it('cleans up only temp when DB insert fails after move (file remains for scanner)', async () => {
      db.select.mockReturnValueOnce(selectJoinChain([makeBookRow()])).mockReturnValueOnce(noHashConflict());
      insertReturning.mockRejectedValue(new Error('DB error'));

      await expect(service.addFileToBook(10, 'book.epub', {} as any, user)).rejects.toThrow('DB error');
      expect(storage.cleanup).toHaveBeenCalledWith('/tmp/upload.bin');
      expect(storage.cleanup).not.toHaveBeenCalledWith('/library/Book Title/book.epub');
    });

    it('cleans up only temp when move fails (destination not yet written)', async () => {
      db.select.mockReturnValueOnce(selectJoinChain([makeBookRow()])).mockReturnValueOnce(noHashConflict());
      storage.moveToPath.mockRejectedValue(new Error('disk full'));

      await expect(service.addFileToBook(10, 'book.epub', {} as any, user)).rejects.toThrow('disk full');
      expect(storage.cleanup).toHaveBeenCalledWith('/tmp/upload.bin');
    });

    it('propagates access errors other than ENOENT from destinationExists check', async () => {
      db.select.mockReturnValueOnce(selectJoinChain([makeBookRow()])).mockReturnValueOnce(noHashConflict());
      mockFsAccess.mockRejectedValue(Object.assign(new Error('permission denied'), { code: 'EACCES' }));

      await expect(service.addFileToBook(10, 'book.epub', {} as any, user)).rejects.toThrow('permission denied');
      expect(storage.moveToPath).not.toHaveBeenCalled();
    });

    it('returns correct createdAt as ISO string', async () => {
      const date = new Date('2025-06-01T12:00:00.000Z');
      insertReturning.mockResolvedValue([
        {
          id: 55,
          format: 'epub',
          role: 'content',
          sizeBytes: 456,
          absolutePath: '/library/Book Title/book.epub',
          createdAt: date,
          durationSeconds: null,
        },
      ]);
      db.select.mockReturnValueOnce(selectJoinChain([makeBookRow()])).mockReturnValueOnce(noHashConflict());

      const result = await service.addFileToBook(10, 'book.epub', {} as any, user);

      expect(result.createdAt).toBe(date.toISOString());
    });
  });

  describe('renameBookFiles', () => {
    it('calls performRename with force=true', async () => {
      const mockRenameService = { performRename: vi.fn().mockResolvedValue({ status: 'success', durationMs: 50 }) };
      moduleRef.get.mockReturnValue(mockRenameService);
      db.select.mockReturnValueOnce(selectChain([{ id: 10, libraryId: 1 }]));

      await expect(service.renameBookFiles(10, user)).resolves.toBeUndefined();
      expect(mockRenameService.performRename).toHaveBeenCalledWith(10, user.id, true, false);
    });

    it('throws NotFoundException when book does not exist', async () => {
      db.select.mockReturnValueOnce(selectChain([]));

      await expect(service.renameBookFiles(999, user)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ForbiddenException when user has no library access', async () => {
      db.select.mockReturnValueOnce(selectChain([{ id: 10, libraryId: 1 }]));
      libraryService.verifyUserAccess.mockRejectedValue(new ForbiddenException('No access'));

      await expect(service.renameBookFiles(10, user)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws ServiceUnavailableException when rename service is unavailable', async () => {
      moduleRef.get.mockReturnValue(null);
      db.select.mockReturnValueOnce(selectChain([{ id: 10, libraryId: 1 }]));

      await expect(service.renameBookFiles(10, user)).rejects.toThrow(ServiceUnavailableException);
    });
  });
});
