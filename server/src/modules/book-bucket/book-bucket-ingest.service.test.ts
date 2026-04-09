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

  return { service, repo, validator, storage };
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
});
