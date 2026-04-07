vi.mock('fs/promises', () => ({ stat: vi.fn() }));
vi.mock('../scanner/lib/hash', () => ({ fingerprintFile: vi.fn() }));

import { InternalServerErrorException } from '@nestjs/common';
import { stat } from 'fs/promises';
import { fingerprintFile } from '../scanner/lib/hash';
import { books, bookFiles, bookMetadata } from '../../db/schema';
import { UploadProcessorService } from './upload-processor.service';

const mockStat = stat as MockedFunction<typeof stat>;
const mockFingerprintFile = fingerprintFile as MockedFunction<typeof fingerprintFile>;

describe('UploadProcessorService', () => {
  const metadataService = {
    extractAndSave: vi.fn(),
  };
  const orchestrator = {
    scheduleIfEligible: vi.fn(),
  };

  const insertBooksReturning = vi.fn();
  const insertBooksValues = vi.fn();
  const insertBookMetadataValues = vi.fn();
  const insertBookFilesReturning = vi.fn();
  const insertBookFilesValues = vi.fn();
  const updateBooksSet = vi.fn();
  const updateBooksWhere = vi.fn();

  const tx = {
    insert: vi.fn((table: unknown) => {
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
    update: vi.fn((table: unknown) => {
      if (table === books) return { set: updateBooksSet };
      throw new Error('unexpected table');
    }),
  };

  const db = {
    transaction: vi.fn(async (callback: (innerTx: typeof tx) => Promise<unknown>) => callback(tx)),
  };

  let service: UploadProcessorService;

  beforeEach(() => {
    vi.resetAllMocks();

    insertBooksValues.mockReturnValue({ returning: insertBooksReturning });
    insertBooksReturning.mockResolvedValue([{ id: 42 }]);
    insertBookMetadataValues.mockResolvedValue(undefined);
    insertBookFilesValues.mockReturnValue({ returning: insertBookFilesReturning });
    insertBookFilesReturning.mockResolvedValue([{ id: 420 }]);
    updateBooksSet.mockReturnValue({ where: updateBooksWhere });
    updateBooksWhere.mockResolvedValue(undefined);

    orchestrator.scheduleIfEligible.mockResolvedValue(undefined);

    mockStat.mockResolvedValue({ ino: 111, mtime: new Date('2024-01-01') } as Awaited<ReturnType<typeof stat>>);
    mockFingerprintFile.mockResolvedValue('hash-abc');

    service = new UploadProcessorService(db as any, metadataService as any, orchestrator as any);
  });

  it('creates book, metadata, and content file rows with fingerprint/stat data in a transaction', async () => {
    const result = await service.createBookRecord(1, 2, '/folder', '/folder/book.epub', 'book/book.epub', 'epub', 12345);

    expect(result).toEqual({ bookId: 42 });
    expect(db.transaction).toHaveBeenCalledTimes(1);
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
        role: 'content',
      }),
    );
    expect(updateBooksSet).toHaveBeenCalledWith({ primaryFileId: 420 });
    expect(orchestrator.scheduleIfEligible).toHaveBeenCalledWith(42, 1, 'event_import');
  });

  it('throws InternalServerErrorException when creating the book row fails', async () => {
    insertBooksReturning.mockResolvedValueOnce([]);

    await expect(service.createBookRecord(1, 2, '/folder', '/folder/book.epub', 'book/book.epub', 'epub', 12345)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('throws InternalServerErrorException when creating the book file row fails', async () => {
    insertBookFilesReturning.mockResolvedValueOnce([]);

    await expect(service.createBookRecord(1, 2, '/folder', '/folder/book.epub', 'book/book.epub', 'epub', 12345)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('logs but suppresses scheduling failures', async () => {
    const warn = vi.spyOn((service as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn').mockImplementation();
    orchestrator.scheduleIfEligible.mockRejectedValue(new Error('queue offline'));

    await service.createBookRecord(1, 2, '/folder', '/folder/book.epub', 'book/book.epub', 'epub', 12345);
    await new Promise((resolve) => setImmediate(resolve));

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('queue offline'));
  });

  it('extractMetadataAsync ignores unsupported formats', () => {
    service.extractMetadataAsync(1, '/tmp/file.txt', 'txt');
    expect(metadataService.extractAndSave).not.toHaveBeenCalled();
  });

  it('extractMetadataAsync logs and suppresses extraction errors', async () => {
    const warn = vi.spyOn((service as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn').mockImplementation();
    metadataService.extractAndSave.mockRejectedValue(new Error('upstream failed'));

    service.extractMetadataAsync(9, '/tmp/a.epub', 'epub');
    await new Promise((resolve) => setImmediate(resolve));

    expect(metadataService.extractAndSave).toHaveBeenCalledWith(9, '/tmp/a.epub', 'epub');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('upstream failed'));
  });

  describe('with undefined orchestrator', () => {
    let serviceNoOrch: UploadProcessorService;

    beforeEach(() => {
      metadataService.extractAndSave.mockResolvedValue(undefined);
      serviceNoOrch = new UploadProcessorService(db as any, metadataService as any, undefined);
    });

    it('createBookRecord completes without scheduling when orchestrator is undefined', async () => {
      const result = await serviceNoOrch.createBookRecord(1, 2, '/folder', '/folder/book.epub', 'book/book.epub', 'epub', 12345);

      expect(result).toEqual({ bookId: 42 });
      expect(orchestrator.scheduleIfEligible).not.toHaveBeenCalled();
    });

    it('extractMetadataAsync handles supported format boundary', () => {
      serviceNoOrch.extractMetadataAsync(1, '/tmp/file.azw', 'azw');

      expect(metadataService.extractAndSave).toHaveBeenCalledWith(1, '/tmp/file.azw', 'azw');
    });
  });
});
