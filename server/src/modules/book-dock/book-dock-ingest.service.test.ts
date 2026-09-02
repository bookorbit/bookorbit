import { BadRequestException, Logger } from '@nestjs/common';
import { Readable } from 'stream';
import { mkdir, realpath, stat } from 'fs/promises';

import { BookDockIngestService } from './book-dock-ingest.service';
import { buildSingleBookCandidate } from '../scanner/lib/walk';

vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  realpath: vi.fn().mockImplementation((p: string) => Promise.resolve(p)),
  stat: vi.fn(),
}));

// Only the folder read is mocked; the interpreter is left real, because what this covers is
// exactly whether its grouping is applied to the folder's files.
vi.mock('../scanner/lib/walk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../scanner/lib/walk')>()),
  buildSingleBookCandidate: vi.fn(),
}));

const mockedStat = vi.mocked(stat);

function makeService(bookDockPath = '/books/book-dock') {
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'storage.bookDockPath') return bookDockPath;
      return undefined;
    }),
  };

  const repo = {
    create: vi.fn(),
    createUnit: vi.fn().mockImplementation((data: Record<string, unknown>) => Promise.resolve({ id: 900, ...data })),
    findById: vi.fn(),
    findByAbsolutePath: vi.fn().mockResolvedValue(null),
    findSelectionBatch: vi.fn(),
    update: vi.fn(),
    countsByStatus: vi.fn().mockResolvedValue({}),
  };

  const validator = {
    sanitizeFilename: vi.fn(),
  };

  const storage = {
    streamToTemp: vi.fn(),
    moveToPath: vi.fn(),
    cleanup: vi.fn().mockResolvedValue(undefined),
  };

  const metadataService = {
    extractAndSave: vi.fn().mockResolvedValue(undefined),
  };

  const events = {
    emit: vi.fn(),
  };

  const appSettings = {
    isBookDockAutoFetchEnabled: vi.fn().mockResolvedValue(false),
  };

  const metadataFetchPipeline = {};

  const processingState = {
    isPaused: vi.fn().mockResolvedValue(false),
    getCachedPaused: vi.fn().mockReturnValue(false),
  };

  const gateway = {
    emitChanged: vi.fn(),
  };

  const service = new BookDockIngestService(
    config as never,
    repo as never,
    validator as never,
    storage as never,
    metadataService as never,
    events as never,
    appSettings as never,
    metadataFetchPipeline as never,
    processingState as never,
    gateway as never,
  );

  return { service, repo, validator, storage, metadataService, events, appSettings, metadataFetchPipeline, processingState, gateway };
}

describe('BookDockIngestService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  it('onApplicationBootstrap resolves bookDockPath to its real path', async () => {
    const { service } = makeService();
    vi.mocked(realpath).mockResolvedValue('/real/books/book-dock');

    await service.onApplicationBootstrap();

    expect(mkdir).toHaveBeenCalledWith('/books/book-dock', { recursive: true });
    expect(realpath).toHaveBeenCalledWith('/books/book-dock');
    expect((service as any).bookDockPath).toBe('/real/books/book-dock');
  });

  it('uses a custom configured Book Dock path', async () => {
    const { service } = makeService('/books/bookdrop');
    vi.mocked(realpath).mockResolvedValue('/real/books/bookdrop');

    await service.onApplicationBootstrap();

    expect(mkdir).toHaveBeenCalledWith('/books/bookdrop', { recursive: true });
    expect(realpath).toHaveBeenCalledWith('/books/bookdrop');
    expect((service as any).bookDockPath).toBe('/real/books/bookdrop');
  });

  it('pauses metadata queue on bootstrap when Book Dock is paused', async () => {
    const { service, processingState } = makeService();
    processingState.isPaused.mockResolvedValue(true);
    const pauseSpy = vi.spyOn((service as any).metadataQueue, 'pause');

    await service.onApplicationBootstrap();

    expect(pauseSpy).toHaveBeenCalledTimes(1);
  });

  describe('ingestUpload', () => {
    it('succeeds and returns the row ID', async () => {
      const { service, validator, storage, repo } = makeService();

      validator.sanitizeFilename.mockReturnValue('book.epub');
      mockedStat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      storage.streamToTemp.mockResolvedValue({ tempPath: '/tmp/upload.bin', sizeBytes: 1024 });
      storage.moveToPath.mockResolvedValue(undefined);
      repo.create.mockResolvedValue({ id: 42 });

      const result = await service.ingestUpload('raw.epub', new Readable({ read() {} }));

      expect(result).toBe(42);
      expect(storage.moveToPath).toHaveBeenCalledWith('/tmp/upload.bin', '/books/book-dock/book.epub');
      expect(repo.create).toHaveBeenCalledWith({
        fileName: 'book.epub',
        absolutePath: '/books/book-dock/book.epub',
        fileSize: 1024,
        format: 'epub',
        status: 'pending',
        uploadedBy: null,
      });
    });

    it('rejects unsupported file format before streaming', async () => {
      const { service, validator, storage } = makeService();

      validator.sanitizeFilename.mockReturnValue('file.xyz');

      const err = await service.ingestUpload('file.xyz', new Readable({ read() {} })).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).message).toMatch(/Unsupported file type/);
      expect(storage.streamToTemp).not.toHaveBeenCalled();
    });

    it('cleans both tempPath and destPath when repo.create fails after move', async () => {
      const { service, validator, storage, repo } = makeService();

      validator.sanitizeFilename.mockReturnValue('book.epub');
      mockedStat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      storage.streamToTemp.mockResolvedValue({ tempPath: '/tmp/upload.bin', sizeBytes: 1024 });
      storage.moveToPath.mockResolvedValue(undefined);
      repo.create.mockRejectedValue(new Error('insert failed'));

      await expect(service.ingestUpload('raw.epub', new Readable({ read() {} }))).rejects.toThrow('insert failed');

      expect(storage.cleanup).toHaveBeenCalledTimes(2);
      expect(storage.cleanup).toHaveBeenCalledWith('/tmp/upload.bin');
      expect(storage.cleanup).toHaveBeenCalledWith('/books/book-dock/book.epub');
    });

    it('cleans both tempPath and destPath when moveToPath fails', async () => {
      const { service, validator, storage } = makeService();

      validator.sanitizeFilename.mockReturnValue('book.epub');
      mockedStat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      storage.streamToTemp.mockResolvedValue({ tempPath: '/tmp/upload.bin', sizeBytes: 1024 });
      storage.moveToPath.mockRejectedValue(new Error('move failed'));

      await expect(service.ingestUpload('raw.epub', new Readable({ read() {} }))).rejects.toThrow('move failed');

      expect(storage.cleanup).toHaveBeenCalledTimes(2);
      expect(storage.cleanup).toHaveBeenCalledWith('/tmp/upload.bin');
      expect(storage.cleanup).toHaveBeenCalledWith('/books/book-dock/book.epub');
    });

    it('appends a unique suffix when the destination filename already exists', async () => {
      const { service, validator, storage, repo } = makeService();

      validator.sanitizeFilename.mockReturnValue('book.epub');
      mockedStat.mockResolvedValue({ size: 100 } as never);
      storage.streamToTemp.mockResolvedValue({ tempPath: '/tmp/upload.bin', sizeBytes: 1024 });
      storage.moveToPath.mockResolvedValue(undefined);
      repo.create.mockResolvedValue({ id: 7 });

      const result = await service.ingestUpload('raw.epub', new Readable({ read() {} }));

      expect(result).toBe(7);
      const destArg = storage.moveToPath.mock.calls[0][1] as string;
      expect(destArg).toMatch(/\/books\/book-dock\/book-\d+-[a-z0-9]+\.epub$/);
    });
  });

  describe('ingestFromWatchedFolder', () => {
    it('skips if file already exists in repo', async () => {
      const { service, repo } = makeService();
      repo.findByAbsolutePath.mockResolvedValue({ id: 1 });

      const result = await service.ingestFromWatchedFolder('/watched/book.epub');
      expect(result).toBeNull();
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('skips unsupported extensions', async () => {
      const { service, repo } = makeService();

      const result = await service.ingestFromWatchedFolder('/watched/readme.txt');
      expect(result).toBeNull();
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('skips if stat fails (file vanished)', async () => {
      const { service, repo } = makeService();
      mockedStat.mockRejectedValue(new Error('ENOENT'));

      const result = await service.ingestFromWatchedFolder('/watched/book.epub');
      expect(result).toBeNull();
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('ingests a valid file from watched folder', async () => {
      const { service, repo } = makeService();
      mockedStat.mockResolvedValue({ size: 2048 } as never);
      repo.create.mockResolvedValue({ id: 10 });

      const result = await service.ingestFromWatchedFolder('/watched/novel.epub');
      expect(result).toBe(10);
      expect(repo.create).toHaveBeenCalledWith({
        fileName: 'novel.epub',
        absolutePath: '/watched/novel.epub',
        fileSize: 2048,
        format: 'epub',
        status: 'pending',
      });
    });

    it('logs warning when extractMetadataAsync fails', async () => {
      const { service, repo } = makeService();
      mockedStat.mockResolvedValue({ size: 1024 } as never);
      repo.create.mockResolvedValue({ id: 5 });
      repo.findById.mockResolvedValue({ id: 5, status: 'pending', format: 'epub', absolutePath: '/watched/book.epub' });

      const metadataService = (service as any).metadataService;
      metadataService.extractAndSave.mockRejectedValue(new Error('parse failed'));

      const result = await service.ingestFromWatchedFolder('/watched/book.epub');
      expect(result).toBe(5);

      await (service as any).metadataQueue.waitForIdle();

      expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('metadata queue job failed'));
      expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('parse failed'));
    });

    it('requeues existing unfinished rows found during a watched-folder rescan', async () => {
      const { service, repo, metadataService } = makeService();
      const row = { id: 6, status: 'extracting', format: 'epub', absolutePath: '/watched/book.epub' };
      repo.findByAbsolutePath.mockResolvedValue(row);
      repo.findById.mockResolvedValue(row);

      const result = await service.ingestFromWatchedFolder('/watched/book.epub');
      await (service as any).metadataQueue.waitForIdle();

      expect(result).toBeNull();
      expect(metadataService.extractAndSave).toHaveBeenCalledWith(6, '/watched/book.epub', 'epub', '/books/book-dock/covers');
    });

    it('does not requeue existing ready rows during a watched-folder rescan', async () => {
      const { service, repo, metadataService } = makeService();
      repo.findByAbsolutePath.mockResolvedValue({ id: 7, status: 'ready', format: 'epub', absolutePath: '/watched/book.epub' });

      const result = await service.ingestFromWatchedFolder('/watched/book.epub');
      await (service as any).metadataQueue.waitForIdle();

      expect(result).toBeNull();
      expect(metadataService.extractAndSave).not.toHaveBeenCalled();
    });
  });

  describe('ingestUnitDirectory', () => {
    function candidateFile(absolutePath: string, format: string, role = 'content') {
      return { absolutePath, relPath: absolutePath, ino: 1n, sizeBytes: 10, mtime: new Date(), format, role };
    }

    /**
     * The bug this replaced: `walkAndIngest` created one row per file, so a 31-track audiobook
     * became 31 books, each resolving its destination from its own chapter-named ID3 tags.
     */
    it('makes one unit out of a multipart audiobook folder, anchored on track one', async () => {
      const { service, repo } = makeService();
      vi.mocked(buildSingleBookCandidate).mockResolvedValue({
        folderPath: '/books/book-dock/Neuromancer',
        files: [
          candidateFile('/books/book-dock/Neuromancer/Chapter 1.mp3', 'mp3'),
          candidateFile('/books/book-dock/Neuromancer/Chapter 2.mp3', 'mp3'),
          candidateFile('/books/book-dock/Neuromancer/cover.jpg', 'jpg', 'cover'),
        ],
      } as never);

      await expect(service.ingestUnitDirectory('/books/book-dock/Neuromancer')).resolves.toBe(1);

      expect(repo.createUnit).toHaveBeenCalledTimes(1);
      const [anchor, files] = repo.createUnit.mock.calls[0];
      expect(anchor).toMatchObject({ fileName: 'Chapter 1.mp3', unitDirectory: '/books/book-dock/Neuromancer', format: 'mp3' });
      expect(files.map((file: { fileName: string; sortOrder: number | null }) => [file.fileName, file.sortOrder])).toEqual([
        ['Chapter 1.mp3', 0],
        ['Chapter 2.mp3', 1],
        ['cover.jpg', null],
      ]);
    });

    /**
     * `buildSingleBookCandidate` returns one candidate for any folder, so without the interpreter
     * a dropped comic run would become a single book of sixty files.
     */
    it('makes one unit per issue out of a dropped comic run', async () => {
      const { service, repo } = makeService();
      vi.mocked(buildSingleBookCandidate).mockResolvedValue({
        folderPath: '/books/book-dock/Saga',
        files: [candidateFile('/books/book-dock/Saga/Saga 001.cbz', 'cbz'), candidateFile('/books/book-dock/Saga/Saga 002.cbz', 'cbz')],
      } as never);

      await expect(service.ingestUnitDirectory('/books/book-dock/Saga')).resolves.toBe(2);

      // None of them owns the folder: claiming it would hide the others from the watcher, and
      // deleting one would take the whole folder with it.
      for (const [anchor] of repo.createUnit.mock.calls) expect(anchor.unitDirectory).toBeNull();
    });

    it('ignores a folder with no supported book file', async () => {
      const { service, repo } = makeService();
      vi.mocked(buildSingleBookCandidate).mockResolvedValue(null as never);

      await expect(service.ingestUnitDirectory('/books/book-dock/empty')).resolves.toBe(0);
      expect(repo.createUnit).not.toHaveBeenCalled();
    });

    it('skips a unit whose primary file already has a row', async () => {
      const { service, repo } = makeService();
      repo.findByAbsolutePath.mockResolvedValue({ id: 3 });
      vi.mocked(buildSingleBookCandidate).mockResolvedValue({
        folderPath: '/books/book-dock/Dune',
        files: [candidateFile('/books/book-dock/Dune/Dune.epub', 'epub')],
      } as never);

      await expect(service.ingestUnitDirectory('/books/book-dock/Dune')).resolves.toBe(0);
      expect(repo.createUnit).not.toHaveBeenCalled();
    });
  });

  describe('retryFetch', () => {
    it('ignores missing, non-error, or formatless rows', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 1, status: 'ready', format: 'epub' }).mockResolvedValueOnce({
        id: 2,
        status: 'error',
        format: null,
      });

      await service.retryFetch(1);
      await service.retryFetch(1);
      await service.retryFetch(2);

      expect(repo.update).not.toHaveBeenCalled();
    });

    it('requeues error rows and restarts extraction pipeline', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue({ id: 3, status: 'error', format: 'epub', absolutePath: '/bucket/3.epub' });
      const extractSpy = vi.spyOn(service as any, 'extractMetadataAsync').mockImplementation(() => undefined);

      await service.retryFetch(3);

      expect(repo.update).toHaveBeenCalledWith(3, { status: 'pending', errorMessage: null });
      expect(extractSpy).toHaveBeenCalledWith(3, 'epub', { primary: 3, secondary: 3 });
    });
  });

  describe('refetchMetadata', () => {
    it.each(['ready', 'error'])('queues a %s row and forces a provider fetch', async (status) => {
      const { service, repo } = makeService();
      const dockRow = {
        id: 4,
        status,
        format: 'epub',
        absolutePath: '/bucket/4.epub',
        errorMessage: status === 'error' ? 'failed' : null,
      };
      repo.findById.mockResolvedValueOnce(dockRow).mockResolvedValueOnce({ ...dockRow, status: 'pending' });
      repo.update.mockResolvedValue(dockRow);
      const autoFetchSpy = vi.spyOn(service as any, 'autoFetchMetadataAsync').mockResolvedValue(undefined);

      await expect(service.refetchMetadata(4)).resolves.toBe(true);
      await (service as any).metadataQueue.waitForIdle();

      expect(repo.update).toHaveBeenCalledWith(4, { status: 'pending', errorMessage: null });
      expect(autoFetchSpy).toHaveBeenCalledWith(4, true);
      expect((service as any).forcedAutoFetchFileIds.has(4)).toBe(false);
    });

    it('ignores missing, active, and unsupported rows', async () => {
      const { service, repo } = makeService();
      repo.findById
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 5, status: 'fetching', format: 'epub' })
        .mockResolvedValueOnce({ id: 6, status: 'ready', format: null, absolutePath: '/bucket/6' });

      await expect(service.refetchMetadata(4)).resolves.toBe(false);
      await expect(service.refetchMetadata(5)).resolves.toBe(false);
      await expect(service.refetchMetadata(6)).resolves.toBe(false);

      expect(repo.update).not.toHaveBeenCalled();
    });

    it('restores the previous state when the work queue rejects the file', async () => {
      const { service, repo } = makeService();
      const dockRow = {
        id: 7,
        status: 'ready',
        format: 'epub',
        absolutePath: '/bucket/7.epub',
        errorMessage: null,
      };
      repo.findById.mockResolvedValue(dockRow);
      repo.update.mockResolvedValue(dockRow);
      vi.spyOn(service as any, 'extractMetadataAsync').mockReturnValue(false);

      await expect(service.refetchMetadata(7)).resolves.toBe(false);

      expect(repo.update).toHaveBeenNthCalledWith(1, 7, { status: 'pending', errorMessage: null });
      expect(repo.update).toHaveBeenNthCalledWith(2, 7, { status: 'ready', errorMessage: null });
      expect((service as any).forcedAutoFetchFileIds.has(7)).toBe(false);
    });
  });

  describe('autoFetchMetadataAsync', () => {
    it('returns early when auto-fetch is disabled', async () => {
      const { service, appSettings, repo } = makeService();
      appSettings.isBookDockAutoFetchEnabled.mockResolvedValue(false);

      await (service as any).autoFetchMetadataAsync(8);

      expect(repo.findById).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('forces an explicit refetch when automatic fetching is disabled', async () => {
      const { service, appSettings, repo, metadataFetchPipeline } = makeService();
      appSettings.isBookDockAutoFetchEnabled.mockResolvedValue(false);
      repo.findById.mockResolvedValue({
        id: 8,
        fileName: 'dune.epub',
        status: 'ready',
        embeddedMetadata: { title: 'Dune' },
      });
      (metadataFetchPipeline as any).runWithSources = vi.fn().mockResolvedValue({
        resolved: { title: 'Dune' },
        sources: { title: 'google' },
      });

      await (service as any).autoFetchMetadataAsync(8, true);

      expect(appSettings.isBookDockAutoFetchEnabled).not.toHaveBeenCalled();
      expect(metadataFetchPipeline.runWithSources).toHaveBeenCalledTimes(1);
      expect(repo.update).toHaveBeenLastCalledWith(
        8,
        expect.objectContaining({
          status: 'ready',
          fetchedMetadata: { title: 'Dune' },
          fetchedMetadataSources: { title: 'google' },
        }),
      );
    });

    it.each([
      {
        fileName: 'Batman #007.cbz',
        embeddedMetadata: {},
        expectedTitle: 'Batman #007',
      },
      {
        fileName: 'Saga.Volume.1.cbz',
        embeddedMetadata: { title: '   ' },
        expectedTitle: 'Saga.Volume.1',
      },
      {
        fileName: 'fallback.cbz',
        embeddedMetadata: { title: '  Canonical Title  ' },
        expectedTitle: 'Canonical Title',
      },
    ])('searches for $fileName with title "$expectedTitle"', async ({ fileName, embeddedMetadata, expectedTitle }) => {
      const { service, appSettings, repo, metadataFetchPipeline } = makeService();
      appSettings.isBookDockAutoFetchEnabled.mockResolvedValue(true);
      repo.findById.mockResolvedValue({ id: 8, fileName, status: 'ready', embeddedMetadata });
      (metadataFetchPipeline as any).runWithSources = vi.fn().mockResolvedValue({ resolved: {}, sources: {} });

      await (service as any).autoFetchMetadataAsync(8);

      expect(metadataFetchPipeline.runWithSources).toHaveBeenCalledWith(
        {
          title: expectedTitle,
          author: undefined,
          isbn: undefined,
          isAudiobook: false,
        },
        {},
      );
      expect(repo.update).toHaveBeenNthCalledWith(1, 8, { status: 'fetching' });
      expect(repo.update).toHaveBeenNthCalledWith(2, 8, { status: 'ready' });
    });

    it('keeps extracted author and ISBN search terms when the title falls back to the filename', async () => {
      const { service, appSettings, repo, metadataFetchPipeline } = makeService();
      appSettings.isBookDockAutoFetchEnabled.mockResolvedValue(true);
      repo.findById.mockResolvedValue({
        id: 8,
        fileName: 'The Sandman #001.cbz',
        status: 'ready',
        embeddedMetadata: {
          authors: ['Neil Gaiman'],
          isbn13: '9781401284770',
        },
      });
      (metadataFetchPipeline as any).runWithSources = vi.fn().mockResolvedValue({ resolved: {}, sources: {} });

      await (service as any).autoFetchMetadataAsync(8);

      expect(metadataFetchPipeline.runWithSources).toHaveBeenCalledWith(
        {
          title: 'The Sandman #001',
          author: 'Neil Gaiman',
          isbn: '9781401284770',
          isAudiobook: false,
        },
        {},
      );
    });

    it('searches audiobook editions for a docked audio file', async () => {
      const { service, appSettings, repo, metadataFetchPipeline } = makeService();
      appSettings.isBookDockAutoFetchEnabled.mockResolvedValue(true);
      repo.findById.mockResolvedValue({ id: 8, fileName: 'dune.m4b', format: 'm4b', status: 'ready', embeddedMetadata: { title: 'Dune' } });
      (metadataFetchPipeline as any).runWithSources = vi.fn().mockResolvedValue({ resolved: {}, sources: {} });

      await (service as any).autoFetchMetadataAsync(8);

      expect(metadataFetchPipeline.runWithSources).toHaveBeenCalledWith(expect.objectContaining({ isAudiobook: true }), {});
    });

    it('updates fetched metadata and confidence after pipeline resolution', async () => {
      const { service, appSettings, repo, metadataFetchPipeline } = makeService();
      appSettings.isBookDockAutoFetchEnabled.mockResolvedValue(true);
      repo.findById.mockResolvedValue({
        id: 9,
        fileName: 'dune.epub',
        status: 'ready',
        embeddedMetadata: { title: 'Dune', isbn13: '9780441172719', authors: ['Frank Herbert'] },
      });
      (metadataFetchPipeline as any).runWithSources = vi.fn().mockResolvedValue({
        resolved: {
          title: 'Dune',
          isbn13: '9780441172719',
          authors: ['Frank Herbert'],
          duration: 1200,
          communityRatings: [
            {
              provider: 'hardcover',
              rating: 4.5,
              ratingCount: 1000,
              updatedAt: '2026-07-22T00:00:00.000Z',
            },
          ],
          hardcoverEditionId: 'hardcover-edition',
        },
        sources: {
          title: 'google',
          duration: 'audible',
          communityRating: 'hardcover',
        },
        providerIds: {
          hardcover: 'hardcover-book',
          openLibrary: 'OL1W',
        },
      });

      await (service as any).autoFetchMetadataAsync(9);

      expect(repo.update).toHaveBeenNthCalledWith(1, 9, { status: 'fetching' });
      expect(repo.update).toHaveBeenNthCalledWith(
        2,
        9,
        expect.objectContaining({
          status: 'ready',
          confidence: 95,
          fetchedMetadata: expect.objectContaining({
            title: 'Dune',
            isbn13: '9780441172719',
            durationSeconds: 1200,
            communityRatings: [{ provider: 'hardcover', rating: 4.5, ratingCount: 1000 }],
            hardcoverId: 'hardcover-book',
            hardcoverEditionId: 'hardcover-edition',
            openLibraryId: 'OL1W',
          }),
          fetchedMetadataSources: expect.objectContaining({
            durationSeconds: 'audible',
            communityRatings: 'hardcover',
            hardcoverId: 'hardcover',
            openLibraryId: 'openLibrary',
          }),
        }),
      );
      const persistedMetadata = repo.update.mock.calls[1]?.[1]?.fetchedMetadata as Record<string, unknown>;
      expect(persistedMetadata).not.toHaveProperty('duration');
      expect(persistedMetadata.communityRatings).toEqual([{ provider: 'hardcover', rating: 4.5, ratingCount: 1000 }]);
    });

    it('falls back to ready status when metadata fetch pipeline throws', async () => {
      const { service, appSettings, repo, metadataFetchPipeline } = makeService();
      appSettings.isBookDockAutoFetchEnabled.mockResolvedValue(true);
      repo.findById.mockResolvedValue({
        id: 10,
        fileName: 'dune.epub',
        status: 'ready',
        embeddedMetadata: { title: 'Dune' },
      });
      (metadataFetchPipeline as any).runWithSources = vi.fn().mockRejectedValue(new Error('provider timeout'));

      await (service as any).autoFetchMetadataAsync(10);

      expect(repo.update).toHaveBeenLastCalledWith(10, { status: 'ready' });
    });

    it('computes low confidence for conflicting ISBN values', async () => {
      const { service, appSettings, repo, metadataFetchPipeline } = makeService();
      appSettings.isBookDockAutoFetchEnabled.mockResolvedValue(true);
      repo.findById.mockResolvedValue({
        id: 11,
        fileName: 'dune.epub',
        status: 'ready',
        embeddedMetadata: { title: 'Dune', isbn13: '9780441172719', authors: ['Frank Herbert'] },
      });
      (metadataFetchPipeline as any).runWithSources = vi.fn().mockResolvedValue({
        resolved: {
          title: 'Dune',
          isbn13: '9780312890173',
          authors: ['Frank Herbert'],
        },
        sources: {},
      });

      await (service as any).autoFetchMetadataAsync(11);

      expect(repo.update).toHaveBeenLastCalledWith(
        11,
        expect.objectContaining({
          status: 'ready',
          confidence: 10,
        }),
      );
    });

    it('computes high confidence when title, author, year, and series align', async () => {
      const { service, appSettings, repo, metadataFetchPipeline } = makeService();
      appSettings.isBookDockAutoFetchEnabled.mockResolvedValue(true);
      repo.findById.mockResolvedValue({
        id: 12,
        fileName: 'dune.epub',
        status: 'ready',
        embeddedMetadata: {
          title: 'Dune: Deluxe Edition',
          authors: ['Herbert, Frank'],
          publishedYear: 1965,
          seriesName: 'Dune Saga',
        },
      });
      (metadataFetchPipeline as any).runWithSources = vi.fn().mockResolvedValue({
        resolved: {
          title: 'Dune',
          authors: ['Frank Herbert'],
          publishedYear: 1965,
          seriesName: 'Dune Saga',
        },
        sources: {},
      });

      await (service as any).autoFetchMetadataAsync(12);

      expect(repo.update).toHaveBeenLastCalledWith(
        12,
        expect.objectContaining({
          status: 'ready',
          confidence: 100,
        }),
      );
    });

    it('marks ready without fetchedMetadata when providers return only undefined fields', async () => {
      const { service, appSettings, repo, metadataFetchPipeline } = makeService();
      appSettings.isBookDockAutoFetchEnabled.mockResolvedValue(true);
      repo.findById.mockResolvedValue({
        id: 13,
        fileName: 'known-title.epub',
        status: 'ready',
        embeddedMetadata: { title: 'Known Title' },
      });
      (metadataFetchPipeline as any).runWithSources = vi.fn().mockResolvedValue({
        resolved: {
          title: undefined,
          authors: undefined,
        },
        sources: {},
      });

      await (service as any).autoFetchMetadataAsync(13);

      expect(repo.update).toHaveBeenNthCalledWith(1, 13, { status: 'fetching' });
      expect(repo.update).toHaveBeenNthCalledWith(2, 13, { status: 'ready' });
    });

    it('clears stale provider metadata when an explicit refetch finds no result', async () => {
      const { service, appSettings, repo, metadataFetchPipeline } = makeService();
      appSettings.isBookDockAutoFetchEnabled.mockResolvedValue(false);
      repo.findById.mockResolvedValue({
        id: 15,
        fileName: 'known-title.epub',
        status: 'ready',
        embeddedMetadata: { title: 'Known Title' },
        fetchedMetadata: { title: 'Stale Title' },
        fetchedMetadataSources: { title: 'google' },
        confidence: 90,
      });
      (metadataFetchPipeline as any).runWithSources = vi.fn().mockResolvedValue({ resolved: {}, sources: {} });

      await (service as any).autoFetchMetadataAsync(15, true);

      expect(repo.update).toHaveBeenNthCalledWith(1, 15, { status: 'fetching' });
      expect(repo.update).toHaveBeenNthCalledWith(2, 15, {
        status: 'ready',
        fetchedMetadata: null,
        confidence: null,
        fetchedMetadataSources: null,
      });
    });

    it('emits a summary refresh before provider fetching starts', async () => {
      const { service, appSettings, repo, metadataFetchPipeline } = makeService();
      appSettings.isBookDockAutoFetchEnabled.mockResolvedValue(true);
      repo.findById.mockResolvedValue({
        id: 14,
        fileName: 'dune.epub',
        status: 'ready',
        embeddedMetadata: { title: 'Dune' },
      });
      const emitSummarySpy = vi.spyOn(service as any, 'emitChange').mockReturnValue(undefined);
      const runWithSources = vi.fn().mockResolvedValue({ resolved: {}, sources: {} });
      (metadataFetchPipeline as any).runWithSources = runWithSources;

      await (service as any).autoFetchMetadataAsync(14);

      expect(repo.update).toHaveBeenNthCalledWith(1, 14, { status: 'fetching' });
      expect(emitSummarySpy).toHaveBeenCalledTimes(1);
      expect(emitSummarySpy.mock.invocationCallOrder[0]).toBeLessThan(runWithSources.mock.invocationCallOrder[0]);
    });
  });

  it('extractMetadataAsync emits summary and ingestion events after successful extraction chain', async () => {
    const { service, repo, metadataService, events } = makeService();
    const autoFetchSpy = vi.spyOn(service as any, 'autoFetchMetadataAsync').mockResolvedValue(undefined);
    const emitSummarySpy = vi.spyOn(service as any, 'emitChange').mockReturnValue(undefined);
    repo.findById.mockResolvedValue({ id: 12, status: 'pending', format: 'epub', absolutePath: '/bucket/12.epub' });

    (service as any).extractMetadataAsync(12, 'epub');
    await (service as any).metadataQueue.waitForIdle();

    expect(metadataService.extractAndSave).toHaveBeenCalledWith(12, '/bucket/12.epub', 'epub', '/books/book-dock/covers');
    expect(autoFetchSpy).toHaveBeenCalledWith(12, false);
    expect(repo.update).toHaveBeenCalledWith(12, { status: 'extracting' });
    expect(emitSummarySpy).toHaveBeenCalledTimes(2);
    expect(events.emit).toHaveBeenCalledWith('book-dock.file.ingested', 12);
  });

  it('processMetadataJob stops before loading rows when processing is paused', async () => {
    const { service, repo, processingState } = makeService();
    processingState.isPaused.mockResolvedValue(true);
    const pauseSpy = vi.spyOn((service as any).metadataQueue, 'pause');

    await (service as any).processMetadataJob(15);

    expect(pauseSpy).toHaveBeenCalledTimes(1);
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it('requeueProcessableFiles batches unfinished rows and skips ready rows', async () => {
    const { service, repo } = makeService();
    repo.findSelectionBatch
      .mockResolvedValueOnce([
        { id: 1, status: 'pending', format: 'epub', absolutePath: '/bucket/1.epub' },
        { id: 2, status: 'extracting', format: 'epub', absolutePath: '/bucket/2.epub' },
        { id: 3, status: 'ready', format: 'epub', absolutePath: '/bucket/3.epub' },
      ])
      .mockResolvedValueOnce([]);
    const enqueueSpy = vi.spyOn((service as any).metadataQueue, 'enqueue').mockReturnValue(true);

    await expect(service.requeueProcessableFiles()).resolves.toBe(2);

    expect(repo.findSelectionBatch).toHaveBeenCalledWith({
      limit: 500,
      afterId: undefined,
      status: 'pending',
      userId: 0,
      canManageAll: true,
    });
    expect(enqueueSpy).toHaveBeenCalledWith(1, { primary: 1, secondary: 1 });
    expect(enqueueSpy).toHaveBeenCalledWith(2, { primary: 2, secondary: 2 });
  });

  it('requeueProcessableFiles does no work while paused', async () => {
    const { service, repo, processingState } = makeService();
    processingState.isPaused.mockResolvedValue(true);

    await expect(service.requeueProcessableFiles()).resolves.toBe(0);

    expect(repo.findSelectionBatch).not.toHaveBeenCalled();
  });

  it('runs metadata extraction jobs newest first and one at a time', async () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const { service, repo, metadataService } = makeService();
      repo.findById.mockImplementation((fileId: number) =>
        Promise.resolve({ id: fileId, status: 'pending', format: 'epub', absolutePath: `/bucket/${fileId}.epub` }),
      );

      let active = 0;
      let maxActive = 0;
      let resolveNewest!: () => void;
      let resolveNewestStarted!: () => void;
      let resolveOlderStarted!: () => void;
      const newestDone = new Promise<void>((resolve) => {
        resolveNewest = resolve;
      });
      const newestStarted = new Promise<void>((resolve) => {
        resolveNewestStarted = resolve;
      });
      const olderStarted = new Promise<void>((resolve) => {
        resolveOlderStarted = resolve;
      });

      metadataService.extractAndSave.mockImplementation((fileId: number) =>
        (async () => {
          active++;
          maxActive = Math.max(maxActive, active);
          try {
            if (fileId === 2) {
              resolveNewestStarted();
              await newestDone;
            } else {
              resolveOlderStarted();
            }
          } finally {
            active--;
          }
        })(),
      );

      (service as any).extractMetadataAsync(1, 'epub');
      (service as any).extractMetadataAsync(2, 'epub');

      await vi.advanceTimersByTimeAsync(250);
      await newestStarted;
      expect(metadataService.extractAndSave).toHaveBeenCalledTimes(1);
      expect(metadataService.extractAndSave).toHaveBeenCalledWith(2, '/bucket/2.epub', 'epub', '/books/book-dock/covers');

      resolveNewest();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(499);
      expect(metadataService.extractAndSave).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      await olderStarted;
      await (service as any).metadataQueue.waitForIdle();

      expect(metadataService.extractAndSave).toHaveBeenCalledTimes(2);
      expect(maxActive).toBe(1);
    } finally {
      randomSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('does not start the next Book Dock file while auto-fetch providers are still running', async () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const { service, repo, appSettings, metadataService, metadataFetchPipeline } = makeService();
      appSettings.isBookDockAutoFetchEnabled.mockResolvedValue(true);
      repo.findById.mockImplementation((fileId: number) =>
        Promise.resolve({
          id: fileId,
          fileName: `Book ${fileId}.epub`,
          status: 'pending',
          format: 'epub',
          absolutePath: `/bucket/${fileId}.epub`,
          embeddedMetadata: { title: `Book ${fileId}` },
        }),
      );

      let activeFetches = 0;
      let maxActiveFetches = 0;
      let resolveNewestFetch!: () => void;
      let resolveNewestFetchStarted!: () => void;
      let resolveOlderFetchStarted!: () => void;
      const newestFetchDone = new Promise<void>((resolve) => {
        resolveNewestFetch = resolve;
      });
      const newestFetchStarted = new Promise<void>((resolve) => {
        resolveNewestFetchStarted = resolve;
      });
      const olderFetchStarted = new Promise<void>((resolve) => {
        resolveOlderFetchStarted = resolve;
      });

      (metadataFetchPipeline as any).runWithSources = vi.fn((params: { title?: string }) =>
        (async () => {
          activeFetches++;
          maxActiveFetches = Math.max(maxActiveFetches, activeFetches);
          try {
            if (params.title === 'Book 2') {
              resolveNewestFetchStarted();
              await newestFetchDone;
            } else {
              resolveOlderFetchStarted();
            }
            return { resolved: {}, sources: {} };
          } finally {
            activeFetches--;
          }
        })(),
      );

      (service as any).extractMetadataAsync(1, 'epub');
      (service as any).extractMetadataAsync(2, 'epub');

      await vi.advanceTimersByTimeAsync(250);
      await newestFetchStarted;
      expect(metadataService.extractAndSave).toHaveBeenCalledTimes(1);

      resolveNewestFetch();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(499);
      expect(metadataService.extractAndSave).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      await olderFetchStarted;
      await (service as any).metadataQueue.waitForIdle();

      expect(metadataService.extractAndSave).toHaveBeenCalledTimes(2);
      expect((metadataFetchPipeline as any).runWithSources).toHaveBeenCalledTimes(2);
      expect(maxActiveFetches).toBe(1);
    } finally {
      randomSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
