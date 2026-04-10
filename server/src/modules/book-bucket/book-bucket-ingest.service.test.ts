import { BadRequestException, Logger } from '@nestjs/common';
import { Readable } from 'stream';
import { stat } from 'fs/promises';

import { BookBucketIngestService } from './book-bucket-ingest.service';

vi.mock('fs/promises', () => ({
  stat: vi.fn(),
}));

const mockedStat = vi.mocked(stat);

function makeService() {
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'storage.appDataPath') return '/books';
      return undefined;
    }),
  };

  const repo = {
    create: vi.fn(),
    findById: vi.fn(),
    findByAbsolutePath: vi.fn().mockResolvedValue(null),
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
    isBookBucketAutoFetchEnabled: vi.fn().mockResolvedValue(false),
  };

  const metadataFetchPipeline = {};

  const gateway = {
    emitSummary: vi.fn(),
  };

  const service = new BookBucketIngestService(
    config as never,
    repo as never,
    validator as never,
    storage as never,
    metadataService as never,
    events as never,
    appSettings as never,
    metadataFetchPipeline as never,
    gateway as never,
  );

  return { service, repo, validator, storage, metadataService, events, appSettings, metadataFetchPipeline, gateway };
}

describe('BookBucketIngestService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
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
      expect(storage.moveToPath).toHaveBeenCalledWith('/tmp/upload.bin', '/books/book-bucket/book.epub');
      expect(repo.create).toHaveBeenCalledWith({
        fileName: 'book.epub',
        absolutePath: '/books/book-bucket/book.epub',
        fileSize: 1024,
        format: 'epub',
        status: 'pending',
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
      expect(storage.cleanup).toHaveBeenCalledWith('/books/book-bucket/book.epub');
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
      expect(storage.cleanup).toHaveBeenCalledWith('/books/book-bucket/book.epub');
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
      expect(destArg).toMatch(/\/books\/book-bucket\/book-\d+-[a-z0-9]+\.epub$/);
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

      const metadataService = (service as any).metadataService;
      metadataService.extractAndSave.mockRejectedValue(new Error('parse failed'));

      const result = await service.ingestFromWatchedFolder('/watched/book.epub');
      expect(result).toBe(5);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('parse failed'));
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
      expect(extractSpy).toHaveBeenCalledWith(3, '/bucket/3.epub', 'epub');
    });
  });

  describe('autoFetchMetadataAsync', () => {
    it('returns early when auto-fetch is disabled or no searchable metadata is available', async () => {
      const { service, appSettings, repo } = makeService();
      appSettings.isBookBucketAutoFetchEnabled.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      repo.findById.mockResolvedValue({
        id: 8,
        status: 'ready',
        embeddedMetadata: { authors: ['No title and no isbn'] },
      });

      await (service as any).autoFetchMetadataAsync(8);
      await (service as any).autoFetchMetadataAsync(8);

      expect(repo.update).not.toHaveBeenCalledWith(8, { status: 'fetching' });
    });

    it('updates fetched metadata and confidence after pipeline resolution', async () => {
      const { service, appSettings, repo, metadataFetchPipeline } = makeService();
      appSettings.isBookBucketAutoFetchEnabled.mockResolvedValue(true);
      repo.findById.mockResolvedValue({
        id: 9,
        status: 'ready',
        embeddedMetadata: { title: 'Dune', isbn13: '9780441172719', authors: ['Frank Herbert'] },
      });
      (metadataFetchPipeline as any).runWithSources = vi.fn().mockResolvedValue({
        resolved: {
          title: 'Dune',
          isbn13: '9780441172719',
          authors: ['Frank Herbert'],
        },
        sources: { title: { provider: 'google' } },
      });

      await (service as any).autoFetchMetadataAsync(9);

      expect(repo.update).toHaveBeenNthCalledWith(1, 9, { status: 'fetching' });
      expect(repo.update).toHaveBeenNthCalledWith(
        2,
        9,
        expect.objectContaining({
          status: 'ready',
          confidence: 95,
          fetchedMetadata: expect.objectContaining({ title: 'Dune', isbn13: '9780441172719' }),
        }),
      );
    });

    it('falls back to ready status when metadata fetch pipeline throws', async () => {
      const { service, appSettings, repo, metadataFetchPipeline } = makeService();
      appSettings.isBookBucketAutoFetchEnabled.mockResolvedValue(true);
      repo.findById.mockResolvedValue({
        id: 10,
        status: 'ready',
        embeddedMetadata: { title: 'Dune' },
      });
      (metadataFetchPipeline as any).runWithSources = vi.fn().mockRejectedValue(new Error('provider timeout'));

      await (service as any).autoFetchMetadataAsync(10);

      expect(repo.update).toHaveBeenLastCalledWith(10, { status: 'ready' });
    });

    it('computes low confidence for conflicting ISBN values', async () => {
      const { service, appSettings, repo, metadataFetchPipeline } = makeService();
      appSettings.isBookBucketAutoFetchEnabled.mockResolvedValue(true);
      repo.findById.mockResolvedValue({
        id: 11,
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
      appSettings.isBookBucketAutoFetchEnabled.mockResolvedValue(true);
      repo.findById.mockResolvedValue({
        id: 12,
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
      appSettings.isBookBucketAutoFetchEnabled.mockResolvedValue(true);
      repo.findById.mockResolvedValue({
        id: 13,
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
  });

  it('extractMetadataAsync emits summary and ingestion events after successful extraction chain', async () => {
    const { service, metadataService, events } = makeService();
    const autoFetchSpy = vi.spyOn(service as any, 'autoFetchMetadataAsync').mockResolvedValue(undefined);
    const emitSummarySpy = vi.spyOn(service as any, 'emitSummary').mockResolvedValue(undefined);

    (service as any).extractMetadataAsync(12, '/bucket/12.epub', 'epub');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(metadataService.extractAndSave).toHaveBeenCalledWith(12, '/bucket/12.epub', 'epub', '/books/book-bucket/covers');
    expect(autoFetchSpy).toHaveBeenCalledWith(12);
    expect(emitSummarySpy).toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalledWith('book-bucket.file.ingested', 12);
  });
});
