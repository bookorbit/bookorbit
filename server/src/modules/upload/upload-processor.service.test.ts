vi.mock('fs/promises', () => ({ stat: vi.fn() }));
vi.mock('../scanner/lib/hash', () => ({ computeFileHash: vi.fn() }));

import { InternalServerErrorException } from '@nestjs/common';
import { stat } from 'fs/promises';
import { computeFileHash } from '../scanner/lib/hash';
import { books, bookFiles, bookMetadata } from '../../db/schema';
import { UploadProcessorService } from './upload-processor.service';

const mockStat = stat as MockedFunction<typeof stat>;
const mockComputeFileHash = computeFileHash as MockedFunction<typeof computeFileHash>;

describe('UploadProcessorService', () => {
  const metadataService = {
    extractAndSave: vi.fn(),
    extractAndAggregateAudioDuration: vi.fn(),
  };
  const orchestrator = {
    scheduleImportedBooksIfEligible: vi.fn(),
  };

  const insertBooksReturning = vi.fn();
  const insertBooksValues = vi.fn();
  const insertBookMetadataValues = vi.fn();
  const insertBookFilesReturning = vi.fn();
  const insertBookFilesValues = vi.fn();
  const insertBookFilesOnConflict = vi.fn();
  const updateBooksSet = vi.fn();
  const updateBooksWhere = vi.fn();

  const selectFrom = vi.fn();
  const selectWhere = vi.fn();
  const selectLimit = vi.fn();

  const tx = {
    select: vi.fn(() => ({ from: selectFrom })),
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

    selectFrom.mockReturnValue({ where: selectWhere });
    selectWhere.mockReturnValue({ limit: selectLimit });
    selectLimit.mockResolvedValue([]); // no existing book by default

    insertBooksValues.mockReturnValue({ returning: insertBooksReturning });
    insertBooksReturning.mockResolvedValue([{ id: 42 }]);
    insertBookMetadataValues.mockResolvedValue(undefined);
    insertBookFilesOnConflict.mockReturnValue({ returning: insertBookFilesReturning });
    insertBookFilesValues.mockReturnValue({ returning: insertBookFilesReturning, onConflictDoUpdate: insertBookFilesOnConflict });
    insertBookFilesReturning.mockResolvedValue([{ id: 420 }]);
    updateBooksSet.mockReturnValue({ where: updateBooksWhere });
    updateBooksWhere.mockResolvedValue(undefined);

    orchestrator.scheduleImportedBooksIfEligible.mockResolvedValue(0);

    mockStat.mockResolvedValue({ ino: 111n, mtime: new Date('2024-01-01') } as Awaited<ReturnType<typeof stat>>);
    mockComputeFileHash.mockResolvedValue('hash-abc');

    service = new UploadProcessorService(db as any, metadataService as any, orchestrator as any);
  });

  it('creates book, metadata, and content file rows with fingerprint/stat data in a transaction', async () => {
    const result = await service.createBookRecord(1, 2, '/folder', '/folder/book.epub', 'book/book.epub', 'epub', 12345);

    expect(result).toEqual({ bookId: 42, created: true });
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
        fileHash: 'hash-abc',
        format: 'epub',
        role: 'content',
      }),
    );
    expect(updateBooksSet).toHaveBeenCalledWith({ primaryFileId: 420 });
    expect(orchestrator.scheduleImportedBooksIfEligible).not.toHaveBeenCalled();
  });

  it('adds a file to an existing book when the folder path already exists in the library', async () => {
    selectLimit.mockResolvedValueOnce([{ id: 99 }]);

    const result = await service.createBookRecord(1, 2, '/folder', '/folder/book2.epub', 'book/book2.epub', 'epub', 5000);

    expect(result).toEqual({ bookId: 99, created: false });
    expect(insertBooksValues).not.toHaveBeenCalled();
    expect(insertBookMetadataValues).not.toHaveBeenCalled();
    expect(updateBooksSet).not.toHaveBeenCalled();
    expect(insertBookFilesValues).toHaveBeenCalledWith(
      expect.objectContaining({
        bookId: 99,
        libraryFolderId: 2,
        absolutePath: '/folder/book2.epub',
        relPath: 'book/book2.epub',
        format: 'epub',
        role: 'content',
      }),
    );
    expect(insertBookFilesOnConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        target: bookFiles.absolutePath,
        set: expect.objectContaining({ bookId: 99, libraryFolderId: 2, format: 'epub' }),
      }),
    );
    expect(orchestrator.scheduleImportedBooksIfEligible).not.toHaveBeenCalled();
  });

  it('clamps oversized MergerFS inode values to 0 before persisting', async () => {
    mockStat.mockResolvedValueOnce({ ino: 14351917807348929000n, mtime: new Date('2024-01-01') } as Awaited<ReturnType<typeof stat>>);

    await service.createBookRecord(1, 2, '/folder', '/folder/book.epub', 'book/book.epub', 'epub', 12345);

    expect(insertBookFilesValues).toHaveBeenCalledWith(
      expect.objectContaining({
        ino: 0,
      }),
    );
  });

  it('clamps oversized MergerFS inode values to 0 in existing-book upserts', async () => {
    selectLimit.mockResolvedValueOnce([{ id: 99 }]);
    mockStat.mockResolvedValueOnce({ ino: 14351917807348929000n, mtime: new Date('2024-01-01') } as Awaited<ReturnType<typeof stat>>);

    await service.createBookRecord(1, 2, '/folder', '/folder/book2.epub', 'book/book2.epub', 'epub', 5000);

    expect(insertBookFilesOnConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          ino: 0,
        }),
      }),
    );
  });

  it('clamps precision-unsafe inodes to 0 before persisting', async () => {
    mockStat.mockResolvedValueOnce({ ino: 651896050678335552n, mtime: new Date('2024-01-01') } as Awaited<ReturnType<typeof stat>>);

    await service.createBookRecord(1, 2, '/folder', '/folder/book.epub', 'book/book.epub', 'epub', 12345);

    expect(insertBookFilesValues).toHaveBeenCalledWith(
      expect.objectContaining({
        ino: 0,
      }),
    );
  });

  it('refreshes a stale book_files record when the absolute path already exists in the db', async () => {
    selectLimit.mockResolvedValueOnce([{ id: 99 }]);
    insertBookFilesOnConflict.mockReturnValueOnce({ returning: vi.fn().mockResolvedValue([{ id: 777 }]) });

    const result = await service.createBookRecord(1, 2, '/folder', '/folder/stale.epub', 'book/stale.epub', 'epub', 1000);

    expect(result).toEqual({ bookId: 99, created: false });
    expect(insertBookFilesOnConflict).toHaveBeenCalled();
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

  it('throws InternalServerErrorException when adding a file to an existing book fails', async () => {
    selectLimit.mockResolvedValueOnce([{ id: 99 }]);
    insertBookFilesReturning.mockResolvedValueOnce([]);

    await expect(service.createBookRecord(1, 2, '/folder', '/folder/book2.epub', 'book/book2.epub', 'epub', 5000)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('extracts local metadata before queueing an import fetch', async () => {
    const order: string[] = [];
    metadataService.extractAndSave.mockImplementation(() => {
      order.push('extract');
      return Promise.resolve();
    });
    orchestrator.scheduleImportedBooksIfEligible.mockImplementation(() => {
      order.push('schedule');
      return Promise.resolve(1);
    });

    await (service as any).runNewBookImport(42, 1, '/folder/book.cbz', 'cbz');

    expect(order).toEqual(['extract', 'schedule']);
    expect(orchestrator.scheduleImportedBooksIfEligible).toHaveBeenCalledWith(1, [42]);
  });

  it('logs but suppresses post-extraction scheduling failures', async () => {
    const warn = vi.spyOn((service as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn').mockImplementation();
    orchestrator.scheduleImportedBooksIfEligible.mockRejectedValue(new Error('queue offline'));

    await (service as any).runNewBookImport(42, 1, '/folder/book.epub', 'epub');

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

  it('extractMetadataAsync extracts per-file duration after saving metadata for audio formats', async () => {
    metadataService.extractAndSave.mockResolvedValue(undefined);
    metadataService.extractAndAggregateAudioDuration.mockResolvedValue(undefined);

    service.extractMetadataAsync(7, '/tmp/book.m4b', 'm4b');
    await new Promise((resolve) => setImmediate(resolve));

    expect(metadataService.extractAndSave).toHaveBeenCalledWith(7, '/tmp/book.m4b', 'm4b');
    expect(metadataService.extractAndAggregateAudioDuration).toHaveBeenCalledWith(7, '/tmp/book.m4b');
  });

  it('extractMetadataAsync skips duration extraction for non-audio formats', async () => {
    metadataService.extractAndSave.mockResolvedValue(undefined);

    service.extractMetadataAsync(7, '/tmp/book.epub', 'epub');
    await new Promise((resolve) => setImmediate(resolve));

    expect(metadataService.extractAndSave).toHaveBeenCalledWith(7, '/tmp/book.epub', 'epub');
    expect(metadataService.extractAndAggregateAudioDuration).not.toHaveBeenCalled();
  });

  it('extractMetadataAsync does not extract duration when metadata save fails for an audio file', async () => {
    vi.spyOn((service as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn').mockImplementation();
    metadataService.extractAndSave.mockRejectedValue(new Error('probe failed'));

    service.extractMetadataAsync(7, '/tmp/book.m4b', 'm4b');
    await new Promise((resolve) => setImmediate(resolve));

    expect(metadataService.extractAndAggregateAudioDuration).not.toHaveBeenCalled();
  });

  it('extractAudioDurationAsync ignores non-audio formats', () => {
    service.extractAudioDurationAsync(7, '/tmp/book.epub', 'epub');
    expect(metadataService.extractAndAggregateAudioDuration).not.toHaveBeenCalled();
  });

  it('extractAudioDurationAsync extracts and aggregates duration for audio formats', async () => {
    metadataService.extractAndAggregateAudioDuration.mockResolvedValue(undefined);

    service.extractAudioDurationAsync(7, '/tmp/chapter-01.mp3', 'mp3');
    await new Promise((resolve) => setImmediate(resolve));

    expect(metadataService.extractAndAggregateAudioDuration).toHaveBeenCalledWith(7, '/tmp/chapter-01.mp3');
  });

  it('extractAudioDurationAsync logs and suppresses extraction errors', async () => {
    const warn = vi.spyOn((service as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn').mockImplementation();
    metadataService.extractAndAggregateAudioDuration.mockRejectedValue(new Error('aggregate failed'));

    service.extractAudioDurationAsync(7, '/tmp/chapter-01.mp3', 'mp3');
    await new Promise((resolve) => setImmediate(resolve));

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('aggregate failed'));
  });

  describe('with undefined orchestrator', () => {
    let serviceNoOrch: UploadProcessorService;

    beforeEach(() => {
      metadataService.extractAndSave.mockResolvedValue(undefined);
      serviceNoOrch = new UploadProcessorService(db as any, metadataService as any, undefined);
    });

    it('createBookRecord completes without scheduling when orchestrator is undefined', async () => {
      const result = await serviceNoOrch.createBookRecord(1, 2, '/folder', '/folder/book.epub', 'book/book.epub', 'epub', 12345);

      expect(result).toEqual({ bookId: 42, created: true });
      expect(orchestrator.scheduleImportedBooksIfEligible).not.toHaveBeenCalled();
    });

    it('extractMetadataAsync handles supported format boundary', () => {
      serviceNoOrch.extractMetadataAsync(1, '/tmp/file.azw', 'azw');

      expect(metadataService.extractAndSave).toHaveBeenCalledWith(1, '/tmp/file.azw', 'azw');
    });
  });
});
