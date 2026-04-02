vi.mock('fs/promises', async () => {
  const actual = await vi.importActual('fs/promises');
  return { ...actual, access: vi.fn() };
});

vi.mock('../metadata/lib/epub', () => ({ extractEpubMetadata: vi.fn() }));
vi.mock('../metadata/lib/cbz-metadata', () => ({ extractCbzMetadata: vi.fn(), extractCbrMetadata: vi.fn(), extractCb7Metadata: vi.fn() }));
vi.mock('../metadata/lib/mobi-parser', () => ({ parseMobiFile: vi.fn() }));
vi.mock('../metadata/lib/pdf-parser', () => ({ parsePdfFile: vi.fn() }));

import { access as fsAccess } from 'fs/promises';
import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { extractEpubMetadata } from '../metadata/lib/epub';

import { UploadService } from './upload.service';

const mockFsAccess = fsAccess as MockedFunction<typeof fsAccess>;
const mockExtractEpubMetadata = extractEpubMetadata as MockedFunction<typeof extractEpubMetadata>;

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
  const db = {
    select: vi.fn(),
  };

  const appSettings = { getUploadPattern: vi.fn() };
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
    extractMetadataAsync: vi.fn(),
  };

  const user = { id: 7, isSuperuser: false, permissions: [] } as any;

  let service: UploadService;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    service = new UploadService(db as any, appSettings as any, libraryService as any, validator as any, storage as any, processor as any);

    validator.sanitizeFilename.mockReturnValue('book.epub');
    validator.validateFormat.mockReturnValue('epub');
    storage.streamToTemp.mockResolvedValue({ tempPath: '/tmp/upload.bin', sizeBytes: 456 });
    storage.moveToPath.mockResolvedValue(undefined);
    storage.cleanup.mockResolvedValue(undefined);
    processor.createBookRecord.mockResolvedValue({ bookId: 99 });
    libraryService.verifyUserAccess.mockResolvedValue(undefined);
    appSettings.getUploadPattern.mockResolvedValue(null);
    mockFsAccess.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    mockExtractEpubMetadata.mockResolvedValue(null);
  });

  it('uploads successfully and kicks off async metadata extraction', async () => {
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
    expect(processor.extractMetadataAsync).toHaveBeenCalledWith(99, '/library/Frank Herbert/Dune.epub', 'epub');
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

  it('throws ConflictException when destination already exists and cleans both temp and destination paths', async () => {
    db.select
      .mockReturnValueOnce(selectChain([{ id: 1, allowedFormats: ['epub'], fileNamingPattern: null }]))
      .mockReturnValueOnce(selectChain([{ id: 2, libraryId: 1, path: '/library' }]));
    mockFsAccess.mockResolvedValue(undefined);

    await expect(service.upload(1, 2, 'raw.epub', {} as any, user)).rejects.toBeInstanceOf(ConflictException);
    expect(storage.cleanup).toHaveBeenCalledWith('/tmp/upload.bin');
    expect(storage.cleanup).toHaveBeenCalledWith('/library/book/book.epub');
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
});
