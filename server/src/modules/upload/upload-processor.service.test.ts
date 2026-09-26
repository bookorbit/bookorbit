vi.mock('fs/promises', () => ({ stat: vi.fn() }));
vi.mock('../scanner/lib/hash', () => ({ computeFileHash: vi.fn() }));

import { InternalServerErrorException } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { stat } from 'fs/promises';
import { computeFileHash } from '../scanner/lib/hash';
import { books, bookFiles, bookMetadata, uploadSessions } from '../../db/schema';
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
  const coverStore = {
    removeCoverDirectory: vi.fn(),
  };

  const insertBooksReturning = vi.fn();
  const insertBooksValues = vi.fn();
  const insertBookMetadataValues = vi.fn();
  const insertBookFilesReturning = vi.fn();
  const insertBookFilesValues = vi.fn();
  const insertBookFilesOnConflict = vi.fn();
  const updateBooksSet = vi.fn();
  const updateBooksWhere = vi.fn();
  const updateSessionSet = vi.fn();
  const updateSessionWhere = vi.fn();

  const selectFrom = vi.fn();
  const selectInnerJoin = vi.fn();
  const selectWhere = vi.fn();
  const selectFor = vi.fn();
  const selectLimit = vi.fn();
  const selectOrderBy = vi.fn();
  const deleteWhere = vi.fn();

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
      if (table === uploadSessions) return { set: updateSessionSet };
      throw new Error('unexpected table');
    }),
    delete: vi.fn((table: unknown) => {
      if (table === books || table === bookFiles) return { where: deleteWhere };
      throw new Error('unexpected table');
    }),
  };

  const db = {
    transaction: vi.fn(async (callback: (innerTx: typeof tx) => Promise<unknown>) => callback(tx)),
  };

  let service: UploadProcessorService;

  beforeEach(() => {
    vi.resetAllMocks();

    selectFrom.mockReturnValue({ where: selectWhere, innerJoin: selectInnerJoin });
    selectInnerJoin.mockReturnValue({ where: selectWhere });
    selectWhere.mockReturnValue({ limit: selectLimit, for: selectFor, orderBy: selectOrderBy });
    selectFor.mockReturnValue({ limit: selectLimit });
    selectLimit.mockResolvedValue([]); // no existing book by default
    selectOrderBy.mockResolvedValue([]); // no content files to rank by default

    insertBooksValues.mockReturnValue({ returning: insertBooksReturning });
    insertBooksReturning.mockResolvedValue([{ id: 42 }]);
    insertBookMetadataValues.mockResolvedValue(undefined);
    insertBookFilesOnConflict.mockReturnValue({ returning: insertBookFilesReturning });
    insertBookFilesValues.mockReturnValue({ returning: insertBookFilesReturning, onConflictDoUpdate: insertBookFilesOnConflict });
    insertBookFilesReturning.mockResolvedValue([{ id: 420 }]);
    updateBooksSet.mockReturnValue({ where: updateBooksWhere });
    updateBooksWhere.mockResolvedValue(undefined);
    deleteWhere.mockResolvedValue(undefined);
    updateSessionSet.mockReturnValue({ where: updateSessionWhere });
    updateSessionWhere.mockResolvedValue(undefined);

    orchestrator.scheduleImportedBooksIfEligible.mockResolvedValue(0);
    coverStore.removeCoverDirectory.mockResolvedValue(undefined);

    mockStat.mockResolvedValue({ ino: 111n, mtime: new Date('2024-01-01') } as Awaited<ReturnType<typeof stat>>);
    mockComputeFileHash.mockResolvedValue('hash-abc');

    service = new UploadProcessorService(db as any, metadataService as any, coverStore as any, orchestrator as any);
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
        ino: 111n,
        sizeBytes: 12345,
        fileHash: 'hash-abc',
        format: 'epub',
        role: 'content',
      }),
    );
    expect(updateBooksSet).toHaveBeenCalledWith({ primaryFileId: 420 });
    expect(orchestrator.scheduleImportedBooksIfEligible).not.toHaveBeenCalled();
  });

  it('persists the session result in the same transaction as the book record', async () => {
    await service.createBookRecord(1, 2, '/folder', '/folder/book.epub', 'book/book.epub', 'epub', 12345, { uploadSessionId: 'session-id' });

    expect(tx.update).toHaveBeenCalledWith(uploadSessions);
    expect(updateSessionSet).toHaveBeenCalledWith(expect.objectContaining({ resultBookId: 42 }));
    expect(updateSessionWhere).toHaveBeenCalled();
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

  it('preserves oversized MergerFS inode values before persisting', async () => {
    mockStat.mockResolvedValueOnce({ ino: 14351917807348929000n, mtime: new Date('2024-01-01') } as Awaited<ReturnType<typeof stat>>);

    await service.createBookRecord(1, 2, '/folder', '/folder/book.epub', 'book/book.epub', 'epub', 12345);

    expect(insertBookFilesValues).toHaveBeenCalledWith(
      expect.objectContaining({
        ino: 14351917807348929000n,
      }),
    );
  });

  it('preserves oversized MergerFS inode values in existing-book upserts', async () => {
    selectLimit.mockResolvedValueOnce([{ id: 99 }]);
    mockStat.mockResolvedValueOnce({ ino: 14351917807348929000n, mtime: new Date('2024-01-01') } as Awaited<ReturnType<typeof stat>>);

    await service.createBookRecord(1, 2, '/folder', '/folder/book2.epub', 'book/book2.epub', 'epub', 5000);

    expect(insertBookFilesOnConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          ino: 14351917807348929000n,
        }),
      }),
    );
  });

  it('preserves precision-unsafe inodes exactly before persisting', async () => {
    mockStat.mockResolvedValueOnce({ ino: 651896050678335552n, mtime: new Date('2024-01-01') } as Awaited<ReturnType<typeof stat>>);

    await service.createBookRecord(1, 2, '/folder', '/folder/book.epub', 'book/book.epub', 'epub', 12345);

    expect(insertBookFilesValues).toHaveBeenCalledWith(
      expect.objectContaining({
        ino: 651896050678335552n,
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
      serviceNoOrch = new UploadProcessorService(db as any, metadataService as any, coverStore as any, undefined);
    });

    it('createBookRecord completes without scheduling when orchestrator is undefined', async () => {
      const result = await serviceNoOrch.createBookRecord(1, 2, '/folder', '/folder/book.epub', 'book/book.epub', 'epub', 12345);

      expect(result).toEqual({ bookId: 42, created: true });
      expect(orchestrator.scheduleImportedBooksIfEligible).not.toHaveBeenCalled();
    });

    it('extractMetadataAsync handles supported format boundary', async () => {
      serviceNoOrch.extractMetadataAsync(1, '/tmp/file.azw', 'azw');
      await new Promise((resolve) => setImmediate(resolve));

      expect(metadataService.extractAndSave).toHaveBeenCalledWith(1, '/tmp/file.azw', 'azw');
    });
  });
  /**
   * Filing a 31-track audiobook through `createBookRecord` opened 31 transactions, so a failure on
   * track three left the first two behind as a book nobody asked for.
   */
  describe('createUnitBookRecords', () => {
    const unitFiles = [
      { folderPath: '/library/Book', absolutePath: '/library/Book/track-01.mp3', relPath: 'Book/track-01.mp3', format: 'mp3', sizeBytes: 10 },
      { folderPath: '/library/Book', absolutePath: '/library/Book/track-02.mp3', relPath: 'Book/track-02.mp3', format: 'mp3', sizeBytes: 20 },
    ];

    it('writes every file of the unit inside one transaction', async () => {
      insertBooksReturning.mockResolvedValueOnce([{ id: 42 }]);
      // The book created for the first file is found again for the second.
      selectLimit
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 42 }])
        .mockResolvedValueOnce([]);

      const result = await service.createUnitBookRecords(1, 2, unitFiles);

      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ bookIds: [42], createdBookIds: [42], attachedFileIds: [], replacedPrimaries: [] });
      expect(insertBooksValues).toHaveBeenCalledTimes(1);
      expect(insertBookFilesValues).toHaveBeenCalledTimes(2);
    });

    it('remembers file rows added to a book that was already there', async () => {
      // Existing book, and no `book_files` row yet at that path.
      selectLimit.mockResolvedValueOnce([{ id: 99 }]).mockResolvedValueOnce([]);
      insertBookFilesReturning.mockResolvedValueOnce([{ id: 777 }]);

      const result = await service.createUnitBookRecords(1, 2, [unitFiles[0]!]);

      expect(result).toEqual({ bookIds: [99], createdBookIds: [], attachedFileIds: [777], replacedPrimaries: [] });
    });

    it('leaves a row that already pointed at that path out of the rollback set', async () => {
      selectLimit.mockResolvedValueOnce([{ id: 99 }]).mockResolvedValueOnce([{ id: 777 }]);

      const result = await service.createUnitBookRecords(1, 2, [unitFiles[0]!]);

      expect(result).toEqual({ bookIds: [99], createdBookIds: [], attachedFileIds: [], replacedPrimaries: [] });
    });

    it('hashes every file before opening the transaction', async () => {
      await service.createUnitBookRecords(1, 2, unitFiles);

      expect(mockComputeFileHash).toHaveBeenCalledTimes(2);
      expect(db.transaction).toHaveBeenCalledTimes(1);
    });

    it('refuses an empty unit rather than creating a book with no files', async () => {
      await expect(service.createUnitBookRecords(1, 2, [])).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  /**
   * A file that joins a book already in the library has to be ranked against the files there. The
   * book used to keep whichever file created it, so an ebook that arrived first stayed primary in
   * a library that ranks audiobooks first.
   */
  describe('ranking the primary of a book a file joins', () => {
    const audioFirst = ['m4b', 'mp3', 'epub', 'pdf'];
    const epubFirst = ['epub', 'pdf', 'm4b', 'mp3'];
    const joinedBook = (overrides: Record<string, unknown> = {}) => ({
      id: 99,
      primaryFileId: 500,
      status: 'present',
      formatPriority: audioFirst,
      ...overrides,
    });
    const ebook = { id: 500, format: 'epub', sizeBytes: 1000, mediaOverlayAvailable: false };
    const audiobook = { id: 777, format: 'm4b', sizeBytes: 5000, mediaOverlayAvailable: false };

    function joinExistingBook(book: ReturnType<typeof joinedBook>, contentFiles: unknown[], newFileId = 777) {
      // The locked book lookup, then no `book_files` row yet at the new path.
      selectLimit.mockResolvedValueOnce([book]).mockResolvedValueOnce([]);
      insertBookFilesReturning.mockResolvedValueOnce([{ id: newFileId }]);
      selectOrderBy.mockResolvedValueOnce(contentFiles);
    }

    it('makes the audiobook primary when it joins an ebook in a library that ranks audio first', async () => {
      joinExistingBook(joinedBook(), [ebook, audiobook]);

      const result = await service.createBookRecord(1, 2, '/folder', '/folder/book.m4b', 'book/book.m4b', 'm4b', 5000);

      expect(result).toEqual({ bookId: 99, created: false });
      expect(updateBooksSet).toHaveBeenCalledTimes(1);
      expect(updateBooksSet).toHaveBeenCalledWith({ primaryFileId: 777, updatedAt: expect.any(Date) });
    });

    it('keeps the ebook primary when the library ranks ebooks first', async () => {
      joinExistingBook(joinedBook({ formatPriority: epubFirst }), [ebook, audiobook]);

      await service.createBookRecord(1, 2, '/folder', '/folder/book.m4b', 'book/book.m4b', 'm4b', 5000);

      expect(updateBooksSet).not.toHaveBeenCalled();
    });

    it('keeps the current primary when the joining file only ties with it', async () => {
      // Plain ranking would take the lowest id among equal EPUBs; the book's own primary has to win the tie.
      const older = { id: 450, format: 'epub', sizeBytes: 900, mediaOverlayAvailable: false };
      const primary = { ...ebook, id: 800 };
      const joining = { ...ebook, id: 900 };
      joinExistingBook(joinedBook({ primaryFileId: 800, formatPriority: epubFirst }), [older, primary, joining], 900);

      await service.createBookRecord(1, 2, '/folder', '/folder/other.epub', 'book/other.epub', 'epub', 1000);

      expect(updateBooksSet).not.toHaveBeenCalled();
    });

    it('prefers a joining read-along EPUB over a plain one, as the scanner does', async () => {
      const readAlong = { id: 900, format: 'epub', sizeBytes: 3000, mediaOverlayAvailable: true };
      joinExistingBook(joinedBook({ formatPriority: epubFirst }), [ebook, readAlong], 900);

      await service.createBookRecord(1, 2, '/folder', '/folder/readalong.epub', 'book/readalong.epub', 'epub', 3000);

      expect(updateBooksSet).toHaveBeenCalledWith({ primaryFileId: 900, updatedAt: expect.any(Date) });
    });

    it('gives a book with no primary one', async () => {
      joinExistingBook(joinedBook({ primaryFileId: null }), [audiobook]);

      await service.createBookRecord(1, 2, '/folder', '/folder/book.m4b', 'book/book.m4b', 'm4b', 5000);

      expect(updateBooksSet).toHaveBeenCalledWith({ primaryFileId: 777, updatedAt: expect.any(Date) });
    });

    it('keeps the primary rather than clearing it when every file is empty', async () => {
      joinExistingBook(joinedBook(), [
        { ...ebook, sizeBytes: 0 },
        { ...audiobook, sizeBytes: 0 },
      ]);

      await service.createBookRecord(1, 2, '/folder', '/folder/book.m4b', 'book/book.m4b', 'm4b', 0);

      expect(updateBooksSet).not.toHaveBeenCalled();
    });

    it('leaves a missing book alone, since its other rows point at files that are gone', async () => {
      joinExistingBook(joinedBook({ status: 'missing' }), [ebook, audiobook]);

      await service.createBookRecord(1, 2, '/folder', '/folder/book.m4b', 'book/book.m4b', 'm4b', 5000);

      expect(selectOrderBy).not.toHaveBeenCalled();
      expect(updateBooksSet).not.toHaveBeenCalled();
    });

    it('does not re-rank for a file that is not content', async () => {
      joinExistingBook(joinedBook(), [ebook, audiobook]);

      await service.createBookRecord(1, 2, '/folder', '/folder/cover.jpg', 'book/cover.jpg', 'jpg', 50, { role: 'cover' });

      expect(selectOrderBy).not.toHaveBeenCalled();
      expect(updateBooksSet).not.toHaveBeenCalled();
    });

    it('does not re-rank a book this call created', async () => {
      await service.createBookRecord(1, 2, '/folder', '/folder/book.epub', 'book/book.epub', 'epub', 12345);

      expect(selectOrderBy).not.toHaveBeenCalled();
      expect(updateBooksSet).toHaveBeenCalledWith({ primaryFileId: 420 });
    });

    it('locks the book it joins until the transaction ends', async () => {
      joinExistingBook(joinedBook(), [ebook, audiobook]);

      await service.createBookRecord(1, 2, '/folder', '/folder/book.m4b', 'book/book.m4b', 'm4b', 5000);

      expect(selectInnerJoin).toHaveBeenCalledTimes(1);
      expect(selectFor).toHaveBeenCalledWith('update', { of: books });
    });

    it('reports the primary a unit replaced so a rollback can put it back', async () => {
      joinExistingBook(joinedBook(), [ebook, audiobook]);

      const result = await service.createUnitBookRecords(1, 2, [
        { folderPath: '/folder', absolutePath: '/folder/book.m4b', relPath: 'book/book.m4b', format: 'm4b', sizeBytes: 5000 },
      ]);

      expect(result).toEqual({
        bookIds: [99],
        createdBookIds: [],
        attachedFileIds: [777],
        replacedPrimaries: [{ bookId: 99, previousPrimaryFileId: 500, primaryFileId: 777 }],
      });
    });

    it('ranks a multi-file unit once, after every file is in', async () => {
      const trackOne = { ...audiobook, id: 777, format: 'mp3' };
      const trackTwo = { ...audiobook, id: 778, format: 'mp3' };
      selectLimit.mockResolvedValueOnce([joinedBook()]).mockResolvedValueOnce([]).mockResolvedValueOnce([joinedBook()]).mockResolvedValueOnce([]);
      insertBookFilesReturning.mockResolvedValueOnce([{ id: 777 }]).mockResolvedValueOnce([{ id: 778 }]);
      selectOrderBy.mockResolvedValueOnce([ebook, trackOne, trackTwo]);

      const result = await service.createUnitBookRecords(1, 2, [
        { folderPath: '/folder', absolutePath: '/folder/01.mp3', relPath: 'book/01.mp3', format: 'mp3', sizeBytes: 5000, sortOrder: 1 },
        { folderPath: '/folder', absolutePath: '/folder/02.mp3', relPath: 'book/02.mp3', format: 'mp3', sizeBytes: 5000, sortOrder: 2 },
      ]);

      expect(selectOrderBy).toHaveBeenCalledTimes(1);
      expect(updateBooksSet).toHaveBeenCalledTimes(1);
      expect(updateBooksSet).toHaveBeenCalledWith({ primaryFileId: 777, updatedAt: expect.any(Date) });
      expect(result.replacedPrimaries).toEqual([{ bookId: 99, previousPrimaryFileId: 500, primaryFileId: 777 }]);
    });

    it('does not re-rank a book the unit itself created', async () => {
      insertBooksReturning.mockResolvedValueOnce([{ id: 42 }]);
      selectLimit
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([joinedBook({ id: 42, primaryFileId: 420 })])
        .mockResolvedValueOnce([]);

      const result = await service.createUnitBookRecords(1, 2, [
        { folderPath: '/folder', absolutePath: '/folder/book.epub', relPath: 'book/book.epub', format: 'epub', sizeBytes: 1000 },
        { folderPath: '/folder', absolutePath: '/folder/book.m4b', relPath: 'book/book.m4b', format: 'm4b', sizeBytes: 5000 },
      ]);

      expect(selectOrderBy).not.toHaveBeenCalled();
      expect(result.replacedPrimaries).toEqual([]);
    });
  });

  describe('deleteUnitBookRecords', () => {
    it('clears the file rows before the books that own them', async () => {
      await service.deleteUnitBookRecords({ bookIds: [42], createdBookIds: [42], attachedFileIds: [777], replacedPrimaries: [] });

      expect(tx.delete).toHaveBeenNthCalledWith(1, bookFiles);
      expect(tx.delete).toHaveBeenNthCalledWith(2, bookFiles);
      expect(tx.delete).toHaveBeenNthCalledWith(3, books);
    });

    const dialect = new PgDialect();
    const restoreWhere = () => dialect.sqlToQuery(updateBooksWhere.mock.calls[0]![0] as SQL);

    it('puts back a primary the unit replaced, after its rows are gone', async () => {
      await service.deleteUnitBookRecords({
        bookIds: [99],
        createdBookIds: [],
        attachedFileIds: [777],
        replacedPrimaries: [{ bookId: 99, previousPrimaryFileId: 500, primaryFileId: 777 }],
      });

      expect(tx.delete).toHaveBeenCalledWith(bookFiles);
      expect(updateBooksSet).toHaveBeenCalledWith({ primaryFileId: 500, updatedAt: expect.any(Date) });
      expect(deleteWhere.mock.invocationCallOrder[0]).toBeLessThan(updateBooksSet.mock.invocationCallOrder[0]!);

      // Only a primary that was cleared, or is still the one the unit chose, is undone, and only
      // onto a file that is still this book's.
      const { sql, params } = restoreWhere();
      expect(sql).toMatch(/"primary_file_id" is null or "books"\."primary_file_id" = \$\d/);
      expect(sql).toMatch(/EXISTS \(SELECT 1 FROM "book_files"/);
      expect(params).toEqual(expect.arrayContaining([99, 777, 500]));
    });

    it('puts back an absent primary without requiring a file for it', async () => {
      await service.deleteUnitBookRecords({
        bookIds: [99],
        createdBookIds: [],
        attachedFileIds: [777],
        replacedPrimaries: [{ bookId: 99, previousPrimaryFileId: null, primaryFileId: 777 }],
      });

      expect(updateBooksSet).toHaveBeenCalledWith({ primaryFileId: null, updatedAt: expect.any(Date) });
      expect(restoreWhere().sql).not.toMatch(/EXISTS/);
    });

    it('puts back a replaced primary even when the unit added no rows of its own', async () => {
      await service.deleteUnitBookRecords({
        bookIds: [99],
        createdBookIds: [],
        attachedFileIds: [],
        replacedPrimaries: [{ bookId: 99, previousPrimaryFileId: 500, primaryFileId: 777 }],
      });

      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(updateBooksSet).toHaveBeenCalledWith({ primaryFileId: 500, updatedAt: expect.any(Date) });
    });

    it('does nothing when the unit created nothing of its own', async () => {
      await service.deleteUnitBookRecords({ bookIds: [99], createdBookIds: [], attachedFileIds: [], replacedPrimaries: [] });

      expect(db.transaction).not.toHaveBeenCalled();
    });

    it('removes covers of the books it created and reconciles the books it only attached to', async () => {
      const coverReconciler = { enqueue: vi.fn().mockResolvedValue(undefined) };
      const withCovers = new UploadProcessorService(
        db as any,
        metadataService as any,
        coverStore as any,
        orchestrator as any,
        coverReconciler as any,
      );

      await withCovers.deleteUnitBookRecords({ bookIds: [42, 7], createdBookIds: [42], attachedFileIds: [777], replacedPrimaries: [] });

      expect(coverStore.removeCoverDirectory).toHaveBeenCalledWith(42);
      expect(coverStore.removeCoverDirectory).not.toHaveBeenCalledWith(7);
      expect(coverReconciler.enqueue).toHaveBeenCalledWith([7], { filesChanged: true });
    });
  });

  it('reconciles cover slots once metadata extraction has written the file’s own cover', async () => {
    const coverReconciler = { enqueue: vi.fn().mockResolvedValue(undefined) };
    const withCovers = new UploadProcessorService(db as any, metadataService as any, coverStore as any, orchestrator as any, coverReconciler as any);
    metadataService.extractAndSave.mockResolvedValue(undefined);
    metadataService.extractAndAggregateAudioDuration.mockResolvedValue(undefined);

    await withCovers.extractMetadata(7, '/tmp/book.m4b', 'm4b');

    expect(coverReconciler.enqueue).toHaveBeenCalledWith([7], { filesChanged: true });
    expect(coverReconciler.enqueue.mock.invocationCallOrder[0]).toBeGreaterThan(metadataService.extractAndSave.mock.invocationCallOrder[0]!);
  });
});
