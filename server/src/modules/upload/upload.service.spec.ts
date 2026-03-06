jest.mock('fs/promises', () => {
  const actual = jest.requireActual('fs/promises');
  return { ...actual, access: jest.fn() };
});

jest.mock('../metadata/lib/epub', () => ({ extractEpubMetadata: jest.fn() }));
jest.mock('../metadata/lib/cbz-metadata', () => ({ extractCbzMetadata: jest.fn(), extractCbrMetadata: jest.fn(), extractCb7Metadata: jest.fn() }));
jest.mock('../metadata/lib/mobi-parser', () => ({ parseMobiFile: jest.fn() }));
jest.mock('../metadata/lib/pdf-parser', () => ({ parsePdfFile: jest.fn() }));

import { access as fsAccess } from 'fs/promises';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { extractEpubMetadata } from '../metadata/lib/epub';

import { UploadService } from './upload.service';

const mockFsAccess = fsAccess as jest.MockedFunction<typeof fsAccess>;
const mockExtractEpubMetadata = extractEpubMetadata as jest.MockedFunction<typeof extractEpubMetadata>;

function selectChain(rows: unknown[]) {
  const whereResult: PromiseLike<unknown[]> & { limit: jest.Mock } = {
    limit: jest.fn().mockResolvedValue(rows),
    then: (resolve) => Promise.resolve(resolve(rows)),
  };

  return {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue(whereResult),
    }),
  };
}

describe('UploadService', () => {
  const db = {
    select: jest.fn(),
  };

  const appSettings = { getUploadPattern: jest.fn() };
  const libraryService = { verifyUserAccess: jest.fn() };
  const validator = {
    sanitizeFilename: jest.fn(),
    validateFormat: jest.fn(),
  };
  const storage = {
    streamToTemp: jest.fn(),
    moveToPath: jest.fn(),
    cleanup: jest.fn(),
  };
  const processor = {
    createBookRecord: jest.fn(),
    extractMetadataAsync: jest.fn(),
  };

  const user = { id: 7, roles: [{ isSuperuser: false }] } as any;

  let service: UploadService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new UploadService(db as any, appSettings as any, libraryService as any, validator as any, storage as any, processor as any);

    validator.sanitizeFilename.mockReturnValue('book.epub');
    validator.validateFormat.mockReturnValue('epub');
    storage.streamToTemp.mockResolvedValue({ tempPath: '/tmp/upload.bin', sizeBytes: 456, truncated: false });
    storage.moveToPath.mockResolvedValue(undefined);
    storage.cleanup.mockResolvedValue(undefined);
    processor.createBookRecord.mockResolvedValue({ bookId: 99 });
    libraryService.verifyUserAccess.mockResolvedValue(undefined);
    appSettings.getUploadPattern.mockResolvedValue(null);
    mockFsAccess.mockRejectedValue(new Error('ENOENT'));
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
    expect(processor.createBookRecord).toHaveBeenCalledWith(1, 2, '/library/Frank Herbert', '/library/Frank Herbert/Dune.epub', 'Frank Herbert/Dune.epub', 'epub', 456);
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

  it('throws ConflictException when destination already exists and cleans temp file', async () => {
    db.select
      .mockReturnValueOnce(selectChain([{ id: 1, allowedFormats: ['epub'], fileNamingPattern: null }]))
      .mockReturnValueOnce(selectChain([{ id: 2, libraryId: 1, path: '/library' }]));
    mockFsAccess.mockResolvedValue(undefined);

    await expect(service.upload(1, 2, 'raw.epub', {} as any, user)).rejects.toBeInstanceOf(ConflictException);
    expect(storage.cleanup).toHaveBeenCalledWith('/tmp/upload.bin');
    expect(storage.moveToPath).not.toHaveBeenCalled();
  });

  it('cleans up temp file when move fails', async () => {
    db.select
      .mockReturnValueOnce(selectChain([{ id: 1, allowedFormats: ['epub'], fileNamingPattern: null }]))
      .mockReturnValueOnce(selectChain([{ id: 2, libraryId: 1, path: '/library' }]));
    storage.moveToPath.mockRejectedValue(new Error('disk full'));

    await expect(service.upload(1, 2, 'raw.epub', {} as any, user)).rejects.toThrow('disk full');
    expect(storage.cleanup).toHaveBeenCalledWith('/tmp/upload.bin');
  });

  it('rejects folder IDs that do not belong to the selected library', async () => {
    db.select
      .mockReturnValueOnce(selectChain([{ id: 1, allowedFormats: ['epub'], fileNamingPattern: null }]))
      .mockReturnValueOnce(selectChain([{ id: 2, libraryId: 999, path: '/wrong' }]));

    await expect(service.upload(1, 2, 'raw.epub', {} as any, user)).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.streamToTemp).not.toHaveBeenCalled();
  });

  it('rejects uploads when no default folder exists for the library', async () => {
    db.select
      .mockReturnValueOnce(selectChain([{ id: 1, allowedFormats: ['epub'], fileNamingPattern: null }]))
      .mockReturnValueOnce(selectChain([]));

    await expect(service.upload(1, undefined, 'raw.epub', {} as any, user)).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.streamToTemp).not.toHaveBeenCalled();
  });
});
