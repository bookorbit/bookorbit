jest.mock('fs/promises', () => ({ stat: jest.fn() }));
jest.mock('../scanner/lib/hash', () => ({ fingerprintFile: jest.fn() }));

import { stat } from 'fs/promises';
import { fingerprintFile } from '../scanner/lib/hash';
import { books, bookFiles, bookMetadata } from '../../db/schema';
import { UploadProcessorService } from './upload-processor.service';

const mockStat = stat as jest.MockedFunction<typeof stat>;
const mockFingerprintFile = fingerprintFile as jest.MockedFunction<typeof fingerprintFile>;

describe('UploadProcessorService', () => {
  const metadataService = {
    extractAndSave: jest.fn(),
  };

  const insertBooksReturning = jest.fn();
  const insertBooksValues = jest.fn();
  const insertBookMetadataValues = jest.fn();
  const insertBookFilesValues = jest.fn();

  const db = {
    insert: jest.fn((table: unknown) => {
      if (table === books) {
        return { values: insertBooksValues };
      }
      if (table === bookMetadata) {
        return { values: insertBookMetadataValues };
      }
      if (table === bookFiles) {
        return { values: insertBookFilesValues };
      }
      throw new Error('unexpected table');
    }),
  };

  let service: UploadProcessorService;

  beforeEach(() => {
    jest.resetAllMocks();

    db.insert.mockImplementation((table: unknown) => {
      if (table === books) {
        return { values: insertBooksValues };
      }
      if (table === bookMetadata) {
        return { values: insertBookMetadataValues };
      }
      if (table === bookFiles) {
        return { values: insertBookFilesValues };
      }
      throw new Error('unexpected table');
    });

    insertBooksValues.mockReturnValue({ returning: insertBooksReturning });
    insertBooksReturning.mockResolvedValue([{ id: 42 }]);
    insertBookMetadataValues.mockResolvedValue(undefined);
    insertBookFilesValues.mockResolvedValue(undefined);

    mockStat.mockResolvedValue({ ino: 111, mtime: new Date('2024-01-01') } as Awaited<ReturnType<typeof stat>>);
    mockFingerprintFile.mockResolvedValue('hash-abc');

    service = new UploadProcessorService(db as any, metadataService as any);
  });

  it('creates book, metadata, and primary file rows with fingerprint/stat data', async () => {
    const result = await service.createBookRecord(1, 2, '/folder', '/folder/book.epub', 'book/book.epub', 'epub', 12345);

    expect(result).toEqual({ bookId: 42 });
    expect(insertBooksValues).toHaveBeenCalledWith({ libraryId: 1, libraryFolderId: 2, folderPath: '/folder', status: 'present' });
    expect(insertBookMetadataValues).toHaveBeenCalledWith({ bookId: 42 });
    expect(insertBookFilesValues).toHaveBeenCalledWith(
      expect.objectContaining({
        bookId: 42,
        libraryFolderId: 2,
        absolutePath: '/folder/book.epub',
        relPath: 'book/book.epub',
        ino: 111,
        sizeBytes: 12345,
        hash: 'hash-abc',
        format: 'epub',
        role: 'primary',
      }),
    );
  });

  it('extractMetadataAsync ignores unsupported formats', () => {
    service.extractMetadataAsync(1, '/tmp/file.txt', 'txt');
    expect(metadataService.extractAndSave).not.toHaveBeenCalled();
  });

  it('extractMetadataAsync logs and suppresses extraction errors', async () => {
    const warn = jest.spyOn((service as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn').mockImplementation();
    metadataService.extractAndSave.mockRejectedValue(new Error('upstream failed'));

    service.extractMetadataAsync(9, '/tmp/a.epub', 'epub');
    await Promise.resolve();

    expect(metadataService.extractAndSave).toHaveBeenCalledWith(9, '/tmp/a.epub', 'epub');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('upstream failed'));
  });
});
