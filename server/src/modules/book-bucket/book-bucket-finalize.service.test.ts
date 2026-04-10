vi.mock('fs/promises', () => ({
  access: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn(),
}));

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { access, readFile, stat, unlink } from 'fs/promises';

import type { BookBucketMetadata } from '@projectx/types';
import { BookBucketFinalizeService } from './book-bucket-finalize.service';

const mockAccess = vi.mocked(access);
const mockReadFile = vi.mocked(readFile);
const mockStat = vi.mocked(stat);
const mockUnlink = vi.mocked(unlink);

function makeService() {
  const db = {
    select: vi.fn(),
    update: vi.fn(),
  };
  const repo = {
    findById: vi.fn(),
    countsByStatus: vi.fn(),
    findByIds: vi.fn(),
    findSelectionBatch: vi.fn(),
    findAllIds: vi.fn(),
    deleteById: vi.fn(),
  };
  const libraryService = {
    verifyUserAccess: vi.fn().mockResolvedValue(undefined),
  };
  const appSettings = {
    getAutoFinalizeSettings: vi.fn(),
    getUploadPattern: vi.fn().mockResolvedValue(null),
  };
  const metadataService = {
    downloadAndSaveCover: vi.fn().mockResolvedValue(false),
    saveExtractedCoverBytes: vi.fn().mockResolvedValue(undefined),
    replaceAuthors: vi.fn().mockResolvedValue(undefined),
    replaceGenres: vi.fn().mockResolvedValue(undefined),
  };
  const validator = {
    validateFormat: vi.fn(),
  };
  const storage = {
    moveToPath: vi.fn().mockResolvedValue(undefined),
  };
  const processor = {
    createBookRecord: vi.fn().mockResolvedValue({ bookId: 101 }),
  };
  const events = {
    on: vi.fn(),
  };
  const gateway = {
    emitSummary: vi.fn(),
  };

  const service = new BookBucketFinalizeService(
    db as never,
    repo as never,
    libraryService as never,
    appSettings as never,
    metadataService as never,
    validator as never,
    storage as never,
    processor as never,
    events as never,
    gateway as never,
  );

  return { service, db, repo, libraryService, appSettings, metadataService, validator, storage, processor, events, gateway };
}

function makeRow(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: 1,
    fileName: 'book.epub',
    absolutePath: '/tmp/book.epub',
    fileSize: 100,
    format: 'epub',
    status: 'ready',
    embeddedMetadata: { title: 'Embedded Title', genres: ['Embedded Genre'] } as BookBucketMetadata,
    selectedMetadata: null as BookBucketMetadata | null,
    fetchedMetadata: null as BookBucketMetadata | null,
    coverPath: null,
    targetLibraryId: null,
    targetFolderId: null,
    confidence: 90,
    fetchedMetadataSources: null,
    errorMessage: null,
    metadataEditedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('BookBucketFinalizeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    mockReadFile.mockResolvedValue(Buffer.from('cover-bytes'));
    mockStat.mockResolvedValue({ size: 100 } as never);
    mockUnlink.mockResolvedValue(undefined);
  });

  describe('triggerAutoFinalize', () => {
    it('merges embedded and fetched metadata when auto-finalizing and selected metadata is empty', async () => {
      const { service, repo, appSettings } = makeService();
      const fetched = { title: 'Fetched Title', authors: ['Fetched Author'] } as BookBucketMetadata;
      const row = makeRow({ selectedMetadata: null, fetchedMetadata: fetched });

      appSettings.getAutoFinalizeSettings.mockResolvedValue({
        enabled: true,
        threshold: 85,
        libraryId: 5,
        folderId: 9,
        metadataMode: 'safe_merge',
      });
      repo.findById.mockResolvedValue(row);

      const finalizeSpy = vi.spyOn(service as never, 'finalizeFile').mockResolvedValue({
        fileId: row.id,
        fileName: row.fileName,
        success: true,
        bookId: 42,
      } as never);
      vi.spyOn(service as never, 'emitSummary').mockResolvedValue(undefined as never);

      await service.triggerAutoFinalize(row.id);

      expect(finalizeSpy).toHaveBeenCalledTimes(1);
      const passedRow = finalizeSpy.mock.calls[0]?.[0] as { selectedMetadata: BookBucketMetadata | null } | undefined;
      expect(passedRow?.selectedMetadata).toEqual({
        title: 'Fetched Title',
        authors: ['Fetched Author'],
        genres: ['Embedded Genre'],
      });
    });

    it('lets selected metadata override fetched and embedded values during auto-finalize', async () => {
      const { service, repo, appSettings } = makeService();
      const manual = { title: 'Manual Title' } as BookBucketMetadata;
      const fetched = { title: 'Fetched Title', authors: ['Fetched Author'] } as BookBucketMetadata;
      const row = makeRow({ selectedMetadata: manual, fetchedMetadata: fetched });

      appSettings.getAutoFinalizeSettings.mockResolvedValue({
        enabled: true,
        threshold: 85,
        libraryId: 5,
        folderId: 9,
        metadataMode: 'safe_merge',
      });
      repo.findById.mockResolvedValue(row);

      const finalizeSpy = vi.spyOn(service as never, 'finalizeFile').mockResolvedValue({
        fileId: row.id,
        fileName: row.fileName,
        success: true,
        bookId: 42,
      } as never);
      vi.spyOn(service as never, 'emitSummary').mockResolvedValue(undefined as never);

      await service.triggerAutoFinalize(row.id);

      expect(finalizeSpy).toHaveBeenCalledTimes(1);
      const passedRow = finalizeSpy.mock.calls[0]?.[0] as { selectedMetadata: BookBucketMetadata | null } | undefined;
      expect(passedRow?.selectedMetadata).toEqual({
        title: 'Manual Title',
        authors: ['Fetched Author'],
        genres: ['Embedded Genre'],
      });
    });

    it('uses fetched metadata only (plus manual selection) in fetched_only mode', async () => {
      const { service, repo, appSettings } = makeService();
      const manual = { title: 'Manual Title' } as BookBucketMetadata;
      const fetched = { authors: ['Fetched Author'] } as BookBucketMetadata;
      const row = makeRow({ selectedMetadata: manual, fetchedMetadata: fetched });

      appSettings.getAutoFinalizeSettings.mockResolvedValue({
        enabled: true,
        threshold: 85,
        libraryId: 5,
        folderId: 9,
        metadataMode: 'fetched_only',
      });
      repo.findById.mockResolvedValue(row);

      const finalizeSpy = vi.spyOn(service as never, 'finalizeFile').mockResolvedValue({
        fileId: row.id,
        fileName: row.fileName,
        success: true,
        bookId: 42,
      } as never);
      vi.spyOn(service as never, 'emitSummary').mockResolvedValue(undefined as never);

      await service.triggerAutoFinalize(row.id);

      const passedRow = finalizeSpy.mock.calls[0]?.[0] as { selectedMetadata: BookBucketMetadata | null } | undefined;
      expect(passedRow?.selectedMetadata).toEqual({
        title: 'Manual Title',
        authors: ['Fetched Author'],
      });
    });

    it('uses embedded metadata only (plus manual selection) in embedded_only mode', async () => {
      const { service, repo, appSettings } = makeService();
      const row = makeRow({
        selectedMetadata: null,
        fetchedMetadata: { title: 'Fetched Title', authors: ['Fetched Author'] } as BookBucketMetadata,
      });

      appSettings.getAutoFinalizeSettings.mockResolvedValue({
        enabled: true,
        threshold: 85,
        libraryId: 5,
        folderId: 9,
        metadataMode: 'embedded_only',
      });
      repo.findById.mockResolvedValue(row);

      const finalizeSpy = vi.spyOn(service as never, 'finalizeFile').mockResolvedValue({
        fileId: row.id,
        fileName: row.fileName,
        success: true,
        bookId: 42,
      } as never);
      vi.spyOn(service as never, 'emitSummary').mockResolvedValue(undefined as never);

      await service.triggerAutoFinalize(row.id);

      const passedRow = finalizeSpy.mock.calls[0]?.[0] as { selectedMetadata: BookBucketMetadata | null } | undefined;
      expect(passedRow?.selectedMetadata).toEqual({
        title: 'Embedded Title',
        genres: ['Embedded Genre'],
      });
    });

    it('ignores confidence threshold in embedded_only mode', async () => {
      const { service, repo, appSettings } = makeService();
      const row = makeRow({ confidence: null });

      appSettings.getAutoFinalizeSettings.mockResolvedValue({
        enabled: true,
        threshold: 85,
        libraryId: 5,
        folderId: 9,
        metadataMode: 'embedded_only',
      });
      repo.findById.mockResolvedValue(row);

      const finalizeSpy = vi.spyOn(service as never, 'finalizeFile').mockResolvedValue({
        fileId: row.id,
        fileName: row.fileName,
        success: true,
        bookId: 42,
      } as never);
      vi.spyOn(service as never, 'emitSummary').mockResolvedValue(undefined as never);

      await service.triggerAutoFinalize(row.id);

      expect(finalizeSpy).toHaveBeenCalledTimes(1);
    });

    it('still requires confidence threshold in fetched_only mode', async () => {
      const { service, repo, appSettings } = makeService();
      const row = makeRow({ confidence: null, fetchedMetadata: { title: 'Fetched Title' } as BookBucketMetadata });

      appSettings.getAutoFinalizeSettings.mockResolvedValue({
        enabled: true,
        threshold: 85,
        libraryId: 5,
        folderId: 9,
        metadataMode: 'fetched_only',
      });
      repo.findById.mockResolvedValue(row);

      const finalizeSpy = vi.spyOn(service as never, 'finalizeFile').mockResolvedValue({
        fileId: row.id,
        fileName: row.fileName,
        success: true,
        bookId: 42,
      } as never);

      await service.triggerAutoFinalize(row.id);

      expect(finalizeSpy).not.toHaveBeenCalled();
    });
  });

  describe('finalize', () => {
    it('returns missing-row failures for explicit ids not found in repository', async () => {
      const { service, repo } = makeService();
      const rowOne = makeRow({ id: 1 });
      repo.findByIds.mockResolvedValue([rowOne]);
      vi.spyOn(service as never, 'buildDuplicateLookup').mockResolvedValue(new Map() as never);
      vi.spyOn(service as never, 'finalizeFile').mockResolvedValueOnce({
        fileId: 1,
        fileName: 'book.epub',
        success: true,
        bookId: 101,
      } as never);
      vi.spyOn(service as never, 'emitSummary').mockResolvedValue(undefined as never);

      const result = await service.finalize(7, true, [1, 2], false, [], 5, 9);

      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.results[1]).toEqual(
        expect.objectContaining({
          fileId: 2,
          success: false,
          message: 'Book Bucket file not found',
        }),
      );
    });

    it('iterates selectAll batches until no rows remain', async () => {
      const { service, repo } = makeService();
      repo.findSelectionBatch.mockResolvedValueOnce([makeRow({ id: 1 }), makeRow({ id: 2 })]).mockResolvedValueOnce([]);
      vi.spyOn(service as never, 'buildDuplicateLookup').mockResolvedValue(new Map() as never);
      vi.spyOn(service as never, 'finalizeFile').mockResolvedValue({
        fileId: 1,
        fileName: 'book.epub',
        success: true,
        bookId: 10,
      } as never);
      vi.spyOn(service as never, 'emitSummary').mockResolvedValue(undefined as never);

      const result = await service.finalize(7, true, [], true, [], 5, 9, [], 'ready', 'foo');

      expect(repo.findSelectionBatch).toHaveBeenCalledTimes(2);
      expect(result.total).toBe(2);
      expect(result.failed).toBe(0);
    });
  });

  describe('finalizeFile', () => {
    it('fails early when destination library or folder is missing', async () => {
      const { service } = makeService();

      await expect((service as any).finalizeFile(makeRow(), undefined, undefined, new Map(), 1, true)).resolves.toEqual({
        fileId: 1,
        fileName: 'book.epub',
        success: false,
        message: 'Destination is not set for this file',
      });
    });

    it('fails when target file already exists at resolved destination', async () => {
      const { service, validator } = makeService();
      vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({ id: 5, allowedFormats: ['epub'], fileNamingPattern: null } as never);
      vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
      vi.spyOn(service as never, 'resolveDestination').mockResolvedValue('/library/existing.epub' as never);
      mockAccess.mockResolvedValueOnce(undefined as never);

      const result = await (service as any).finalizeFile(
        makeRow({ targetLibraryId: 5, targetFolderId: 9 }),
        undefined,
        undefined,
        new Map(),
        1,
        true,
      );

      expect(result).toEqual({
        fileId: 1,
        fileName: 'book.epub',
        success: false,
        message: 'A file with this name already exists at the target location',
      });
      expect(validator.validateFormat).toHaveBeenCalled();
    });

    it('marks rows as duplicates when duplicate lookup finds an existing book', async () => {
      const { service } = makeService();
      vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({ id: 5, allowedFormats: ['epub'], fileNamingPattern: null } as never);
      vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
      vi.spyOn(service as never, 'resolveDestination').mockResolvedValue('/library/new.epub' as never);
      mockAccess.mockRejectedValueOnce(new Error('missing'));
      vi.spyOn(service as never, 'findDuplicate').mockResolvedValue(77 as never);

      await expect(
        (service as any).finalizeFile(makeRow({ targetLibraryId: 5, targetFolderId: 9 }), undefined, undefined, new Map(), 1, true),
      ).resolves.toEqual(
        expect.objectContaining({
          success: false,
          isDuplicate: true,
          existingBookId: 77,
        }),
      );
    });

    it('rolls back moved files and reports failure when book record creation fails', async () => {
      const { service, storage, processor } = makeService();
      vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({ id: 5, allowedFormats: ['epub'], fileNamingPattern: null } as never);
      vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
      vi.spyOn(service as never, 'resolveDestination').mockResolvedValue('/library/new/book.epub' as never);
      vi.spyOn(service as never, 'findDuplicate').mockResolvedValue(null as never);
      mockAccess.mockRejectedValueOnce(new Error('missing'));
      mockStat.mockResolvedValueOnce({ size: 321 } as never);
      processor.createBookRecord.mockRejectedValueOnce(new Error('create failed'));

      await expect(
        (service as any).finalizeFile(makeRow({ targetLibraryId: 5, targetFolderId: 9 }), undefined, undefined, new Map(), 1, true),
      ).resolves.toEqual(
        expect.objectContaining({
          success: false,
          message: 'create failed',
        }),
      );
      expect(storage.moveToPath).toHaveBeenNthCalledWith(1, '/tmp/book.epub', '/library/new/book.epub');
      expect(storage.moveToPath).toHaveBeenNthCalledWith(2, '/library/new/book.epub', '/tmp/book.epub');
    });

    it('returns success with relative newName when finalize flow completes', async () => {
      const { service, processor } = makeService();
      vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({ id: 5, allowedFormats: ['epub'], fileNamingPattern: null } as never);
      vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
      vi.spyOn(service as never, 'resolveDestination').mockResolvedValue('/library/new/book.epub' as never);
      vi.spyOn(service as never, 'findDuplicate').mockResolvedValue(null as never);
      vi.spyOn(service as never, 'applyMetadata').mockResolvedValue(undefined as never);
      vi.spyOn(service as never, 'cleanupBookBucketRecord').mockResolvedValue(undefined as never);
      mockAccess.mockRejectedValueOnce(new Error('missing'));
      mockStat.mockResolvedValueOnce({ size: 100 } as never);
      processor.createBookRecord.mockResolvedValueOnce({ bookId: 555 });

      await expect(
        (service as any).finalizeFile(makeRow({ targetLibraryId: 5, targetFolderId: 9 }), undefined, undefined, new Map(), 1, true),
      ).resolves.toEqual({
        fileId: 1,
        fileName: 'book.epub',
        newName: 'new/book.epub',
        success: true,
        bookId: 555,
      });
    });
  });

  it('previewNames returns [] for empty explicit selection', async () => {
    const { service } = makeService();

    await expect(service.previewNames([], false, [], 5)).resolves.toEqual([]);
  });

  it('previewNames uses selectAll ids and preserves original filename when no pattern resolves', async () => {
    const { service, repo, appSettings, db } = makeService();
    repo.findAllIds.mockResolvedValue([1]);
    repo.findByIds.mockResolvedValue([makeRow({ id: 1 })]);
    appSettings.getUploadPattern.mockResolvedValue(null);
    db.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    await expect(service.previewNames([], true, [], undefined, 'ready', 'title')).resolves.toEqual([
      { fileId: 1, fileName: 'book.epub', newName: 'book.epub' },
    ]);
  });

  it('applyMetadata updates scalar metadata fields and related author/genre rows', async () => {
    const { service, db, metadataService } = makeService();
    const updateChain = {
      set: vi.fn(),
      where: vi.fn().mockResolvedValue(undefined),
    };
    updateChain.set.mockReturnValue(updateChain);
    db.update.mockReturnValue(updateChain);
    const bucketRow = makeRow({
      selectedMetadata: {
        title: 'New Title',
        subtitle: 'Sub',
        description: 'Desc',
        isbn13: '9780306406157',
        publisher: 'Pub',
        publishedYear: 2022,
        language: 'en-US',
        pageCount: 300,
        seriesName: 'Saga',
        seriesIndex: 2.5,
        authors: ['Author A'],
        genres: ['Fantasy'],
      } as BookBucketMetadata,
      coverPath: null,
    });

    await (service as any).applyMetadata(15, bucketRow);

    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'New Title',
        subtitle: 'Sub',
        description: 'Desc',
        isbn13: '9780306406157',
        publisher: 'Pub',
        publishedYear: 2022,
        language: 'en-US',
        pageCount: 300,
        seriesName: 'Saga',
        seriesIndex: 2.5,
      }),
    );
    expect(metadataService.replaceAuthors).toHaveBeenCalledWith(15, [{ name: 'Author A', sortName: null }]);
    expect(metadataService.replaceGenres).toHaveBeenCalledWith(15, ['Fantasy']);
  });

  it('applyMetadata prefers selected coverUrl and skips extracted cover copy when download succeeds', async () => {
    const { service, db, metadataService } = makeService();
    metadataService.downloadAndSaveCover.mockResolvedValueOnce(true);
    const updateChain = {
      set: vi.fn(),
      where: vi.fn().mockResolvedValue(undefined),
    };
    updateChain.set.mockReturnValue(updateChain);
    db.update.mockReturnValue(updateChain);
    mockReadFile.mockResolvedValue(Buffer.from('cover-bytes'));

    await (service as any).applyMetadata(
      20,
      makeRow({
        coverPath: '/tmp/cover.jpg',
        selectedMetadata: { title: 'T', coverUrl: 'https://covers.example/1.jpg' } as BookBucketMetadata,
      }),
    );

    expect(metadataService.downloadAndSaveCover).toHaveBeenCalledWith('https://covers.example/1.jpg', 20);
    expect(metadataService.saveExtractedCoverBytes).not.toHaveBeenCalled();
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('applyMetadata falls back to extracted cover bytes when cover download is unavailable', async () => {
    const { service, db, metadataService } = makeService();
    metadataService.downloadAndSaveCover.mockResolvedValueOnce(false);
    const updateChain = {
      set: vi.fn(),
      where: vi.fn().mockResolvedValue(undefined),
    };
    updateChain.set.mockReturnValue(updateChain);
    db.update.mockReturnValue(updateChain);
    mockReadFile.mockResolvedValueOnce(Buffer.from('cover-bytes'));

    await (service as any).applyMetadata(
      21,
      makeRow({
        coverPath: '/tmp/cover.jpg',
        selectedMetadata: { title: 'T', coverUrl: 'https://covers.example/1.jpg' } as BookBucketMetadata,
      }),
    );

    expect(metadataService.saveExtractedCoverBytes).toHaveBeenCalledWith(21, Buffer.from('cover-bytes'));
  });

  it('cleanupBookBucketRecord deletes cover files and bucket row id', async () => {
    const { service, repo } = makeService();
    mockUnlink.mockResolvedValue(undefined);

    await (service as any).cleanupBookBucketRecord(makeRow({ id: 44, coverPath: '/tmp/cover.png' }));

    expect(mockUnlink).toHaveBeenCalledWith('/tmp/cover.png');
    expect(mockUnlink).toHaveBeenCalledWith('/tmp/cover_thumb.jpg');
    expect(repo.deleteById).toHaveBeenCalledWith(44);
  });

  it('findLibraryOrFail and findFolderOrFail throw typed errors for invalid destination records', async () => {
    const { service, db } = makeService();
    const selectChain = {
      from: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(),
    };
    selectChain.from.mockReturnValue(selectChain);
    selectChain.where.mockReturnValue(selectChain);
    selectChain.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 9, libraryId: 4, path: '/x' }]);
    db.select.mockReturnValue(selectChain);

    await expect((service as any).findLibraryOrFail(2)).rejects.toBeInstanceOf(NotFoundException);
    await expect((service as any).findFolderOrFail(9, 5)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('buildDuplicateLookup collects isbn and title keys per library', async () => {
    const { service, db } = makeService();
    const selectChain = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      where: vi.fn(),
    };
    selectChain.from.mockReturnValue(selectChain);
    selectChain.innerJoin.mockReturnValue(selectChain);
    selectChain.where
      .mockResolvedValueOnce([{ bookId: 11, isbn13: '9780306406157' }])
      .mockResolvedValueOnce([{ bookId: 12, isbn10: '0306406152' }])
      .mockResolvedValueOnce([{ bookId: 13, normalizedTitle: 'dune' }]);
    db.select.mockReturnValue(selectChain);

    const lookup = await (service as any).buildDuplicateLookup(
      [
        makeRow({ id: 1, targetLibraryId: 5, selectedMetadata: { isbn13: '9780306406157' } }),
        makeRow({ id: 2, targetLibraryId: 5, selectedMetadata: { isbn10: '0306406152' } }),
        makeRow({ id: 3, targetLibraryId: 5, selectedMetadata: { title: 'Dune' } }),
      ],
      undefined,
      new Map(),
    );

    expect(lookup.get('library:5|isbn13:9780306406157')).toBe(11);
    expect(lookup.get('library:5|isbn10:0306406152')).toBe(12);
    expect(lookup.get('library:5|title:dune')).toBe(13);
  });

  it('findDuplicate queries by isbn and title when prebuilt lookup misses', async () => {
    const { service, db } = makeService();
    const selectChain = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(),
    };
    selectChain.from.mockReturnValue(selectChain);
    selectChain.innerJoin.mockReturnValue(selectChain);
    selectChain.where.mockReturnValue(selectChain);
    selectChain.limit
      .mockResolvedValueOnce([{ bookId: 91 }])
      .mockResolvedValueOnce([{ bookId: 92 }])
      .mockResolvedValueOnce([]);
    db.select.mockReturnValue(selectChain);

    await expect((service as any).findDuplicate(4, { isbn13: '9780306406157', isbn10: null, title: null })).resolves.toBe(91);
    await expect((service as any).findDuplicate(4, { isbn13: null, isbn10: null, title: 'Dune' })).resolves.toBe(92);
    await expect((service as any).findDuplicate(4, { isbn13: null, isbn10: null, title: null })).resolves.toBeNull();
  });

  it('resolveDestination builds names from patterns and falls back to original filename', async () => {
    const { service, appSettings } = makeService();
    appSettings.getUploadPattern.mockResolvedValue(null);
    const rowWithMeta = makeRow({
      fileName: 'original.epub',
      selectedMetadata: { title: 'Dune', seriesIndex: 2.5 } as BookBucketMetadata,
    });

    await expect((service as any).resolveDestination({ fileNamingPattern: '{title}-{seriesIndex}' }, '/library', rowWithMeta, 'epub')).resolves.toBe(
      '/library/Dune-02.5.epub',
    );
    await expect((service as any).resolveDestination({ fileNamingPattern: null }, '/library', rowWithMeta, 'epub')).resolves.toBe(
      '/library/original.epub',
    );
  });

  it('findDuplicate resolves from prebuilt lookup before querying database', async () => {
    const { service } = makeService();
    const duplicateLookup = new Map([['library:4|isbn13:9780306406157', 88]]);

    await expect((service as any).findDuplicate(4, { isbn13: '9780306406157', isbn10: null, title: null }, duplicateLookup)).resolves.toBe(88);
  });

  it('triggerAutoFinalize skips when auto-finalize is disabled or destination is incomplete', async () => {
    const { service, appSettings, repo } = makeService();
    appSettings.getAutoFinalizeSettings.mockResolvedValueOnce({
      enabled: false,
      threshold: 80,
      libraryId: 1,
      folderId: 2,
      metadataMode: 'safe_merge',
    });
    appSettings.getAutoFinalizeSettings.mockResolvedValueOnce({
      enabled: true,
      threshold: 80,
      libraryId: null,
      folderId: 2,
      metadataMode: 'safe_merge',
    });

    await service.triggerAutoFinalize(1);
    await service.triggerAutoFinalize(1);

    expect(repo.findById).not.toHaveBeenCalled();
  });

  it('onModuleInit subscribes to ingestion events and triggers auto-finalize callback', async () => {
    const { service, events } = makeService();
    const triggerSpy = vi.spyOn(service, 'triggerAutoFinalize').mockResolvedValue(undefined);

    service.onModuleInit();
    const handler = events.on.mock.calls[0]?.[1] as ((fileId: number) => void) | undefined;
    expect(handler).toBeDefined();
    handler?.(77);
    await Promise.resolve();

    expect(triggerSpy).toHaveBeenCalledWith(77);
  });
});
