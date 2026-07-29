import { ConfigService } from '@nestjs/config';
import type { MockedFunction } from 'vitest';
import { readdir, readFile, stat } from 'fs/promises';
import {
  AUDIO_BOOK_FILE_WRITE_FIELDS,
  EPUB_BOOK_FILE_WRITE_FIELDS,
  FB2_BOOK_FILE_WRITE_FIELDS,
  MOBI_BOOK_FILE_WRITE_FIELDS,
  NotificationType,
} from '@bookorbit/types';
import { SelfWriteRegistry } from '../../common/services/self-write-registry.service';

const { computeFileHashMock } = vi.hoisted(() => ({
  computeFileHashMock: vi.fn(),
}));

vi.mock('../scanner/lib/hash', () => ({
  computeFileHash: computeFileHashMock,
}));

import { FileWriteService } from './file-write.service';
import { bookOperationLockKey } from './file-lock.service';

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual('fs/promises');
  return {
    ...actual,
    readdir: vi.fn(),
    readFile: vi.fn(),
    stat: vi.fn(),
  };
});

const mockReaddir = readdir as MockedFunction<typeof readdir>;
const mockReadFile = readFile as MockedFunction<typeof readFile>;
const mockStat = stat as MockedFunction<typeof stat>;
const POST_WRITE_MTIME = new Date('2026-07-22T12:34:56.789Z');

const DEFAULT_LIB_CONFIG = {
  fileWriteEnabled: true,
  fileWriteWriteCover: true,
  fileWriteEpubEnabled: true,
  fileWriteEpubMaxFileSizeMb: 100,
  fileWriteFb2Enabled: true,
  fileWriteFb2MaxFileSizeMb: 100,
  fileWritePdfEnabled: true,
  fileWritePdfMaxFileSizeMb: 100,
  fileWriteCbxEnabled: true,
  fileWriteCbxMaxFileSizeMb: 500,
  fileWriteKindleEnabled: true,
  fileWriteKindleMaxFileSizeMb: 100,
  fileWriteAudioEnabled: true,
  fileWriteAudioMaxFileSizeMb: 500,
};

describe('FileWriteService', () => {
  function makeService(configValues: Record<string, unknown> = {}) {
    const fileWriteRepo = {
      findPrimaryFileForBook: vi.fn(),
      findFilesForBook: vi.fn(),
      findLibraryFileWriteConfig: vi.fn().mockResolvedValue({ ...DEFAULT_LIB_CONFIG }),
      loadPayload: vi.fn(),
      findWriteLog: vi.fn(),
      findNonMissingPrimaryFilesByLibrary: vi.fn(),
      findLibraryWriteSettingsForBook: vi.fn(),
      insertLog: vi.fn().mockResolvedValue(undefined),
      setLastWrittenAt: vi.fn().mockResolvedValue(undefined),
      updateFileStat: vi.fn().mockResolvedValue(undefined),
      recordHashHistory: vi.fn().mockResolvedValue(undefined),
    };
    const writer = {
      write: vi.fn(),
    };
    const registry = {
      supports: vi.fn().mockReturnValue(true),
      get: vi.fn().mockReturnValue(writer),
    };
    const lockService = {
      withLock: vi.fn().mockImplementation(async (_path: string, fn: () => Promise<unknown>) => fn()),
    };
    const config = {
      get: vi.fn().mockImplementation((key: string) => (key === 'storage.appDataPath' ? '/books' : configValues[key])),
    } as unknown as ConfigService;

    const notificationService = {
      notify: vi.fn().mockResolvedValue(undefined),
    };
    const selfWriteRegistry = new SelfWriteRegistry();
    const service = new FileWriteService(
      fileWriteRepo as never,
      registry as never,
      lockService as never,
      config,
      notificationService as never,
      selfWriteRegistry,
    );

    return { service, fileWriteRepo, registry, writer, lockService, notificationService, selfWriteRegistry };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockReaddir.mockReset();
    mockReadFile.mockReset();
    mockStat.mockReset();
    mockStat.mockResolvedValue({ mtime: POST_WRITE_MTIME, size: 57n, ino: 9_007_199_254_740_993n } as never);
    computeFileHashMock.mockReset();
    computeFileHashMock.mockRejectedValue(new Error('missing file'));
  });

  describe('resolveBookFileWriteStatus', () => {
    it('returns enabled for a writable primary file', () => {
      const { service } = makeService();

      expect(service.resolveBookFileWriteStatus(DEFAULT_LIB_CONFIG, [{ id: 1, format: 'epub', sizeBytes: 1024 }], 1)).toEqual({
        enabled: true,
        reason: null,
        writableFormats: ['epub'],
        writableFields: [...EPUB_BOOK_FILE_WRITE_FIELDS],
      });
    });

    it('excludes cover from writable fields when cover writing is disabled', () => {
      const { service } = makeService();

      expect(
        service.resolveBookFileWriteStatus({ ...DEFAULT_LIB_CONFIG, fileWriteWriteCover: false }, [{ id: 1, format: 'epub', sizeBytes: 1024 }], 1),
      ).toEqual({
        enabled: true,
        reason: null,
        writableFormats: ['epub'],
        writableFields: EPUB_BOOK_FILE_WRITE_FIELDS.filter((field) => field !== 'coverBytes'),
      });
    });

    it('uses all audio files when the primary file is audio', () => {
      const { service, registry } = makeService();
      registry.supports.mockImplementation((format: string) => ['mp3', 'm4b'].includes(format));

      expect(
        service.resolveBookFileWriteStatus(
          DEFAULT_LIB_CONFIG,
          [
            { id: 1, format: 'mp3', sizeBytes: 1024 },
            { id: 2, format: 'm4b', sizeBytes: 2048 },
            { id: 3, format: 'opus', sizeBytes: 4096 },
          ],
          1,
        ),
      ).toEqual({
        enabled: true,
        reason: null,
        writableFormats: ['mp3', 'm4b'],
        writableFields: [...AUDIO_BOOK_FILE_WRITE_FIELDS],
      });
    });

    it('returns disabled when library write-back is disabled', () => {
      const { service } = makeService();

      expect(
        service.resolveBookFileWriteStatus({ ...DEFAULT_LIB_CONFIG, fileWriteEnabled: false }, [{ id: 1, format: 'epub', sizeBytes: 1024 }], 1),
      ).toEqual({
        enabled: false,
        reason: 'library_disabled',
        writableFormats: [],
        writableFields: [],
      });
    });

    it('returns disabled when the target exceeds its format size limit', () => {
      const { service } = makeService();

      expect(
        service.resolveBookFileWriteStatus(
          { ...DEFAULT_LIB_CONFIG, fileWriteEpubMaxFileSizeMb: 1 },
          [{ id: 1, format: 'epub', sizeBytes: 2 * 1024 * 1024 }],
          1,
        ),
      ).toEqual({
        enabled: false,
        reason: 'file_exceeds_size_limit',
        writableFormats: [],
        writableFields: [],
      });
    });

    it('returns the FB2 field set for fb2 files', () => {
      const { service, registry } = makeService();
      registry.supports.mockImplementation((value: string) => value === 'fb2');

      expect(service.resolveBookFileWriteStatus(DEFAULT_LIB_CONFIG, [{ id: 1, format: 'fb2', sizeBytes: 1024 }], 1)).toEqual({
        enabled: true,
        reason: null,
        writableFormats: ['fb2'],
        writableFields: [...FB2_BOOK_FILE_WRITE_FIELDS],
      });
    });

    it('honours the FB2 enable toggle', () => {
      const { service, registry } = makeService();
      registry.supports.mockImplementation((value: string) => value === 'fb2');

      expect(
        service.resolveBookFileWriteStatus({ ...DEFAULT_LIB_CONFIG, fileWriteFb2Enabled: false }, [{ id: 1, format: 'fb2', sizeBytes: 1024 }], 1),
      ).toEqual({
        enabled: false,
        reason: 'format_disabled',
        writableFormats: [],
        writableFields: [],
      });
    });

    it('honours the FB2 size limit', () => {
      const { service, registry } = makeService();
      registry.supports.mockImplementation((value: string) => value === 'fb2');

      expect(
        service.resolveBookFileWriteStatus(
          { ...DEFAULT_LIB_CONFIG, fileWriteFb2MaxFileSizeMb: 1 },
          [{ id: 1, format: 'fb2', sizeBytes: 2 * 1024 * 1024 }],
          1,
        ),
      ).toEqual({
        enabled: false,
        reason: 'file_exceeds_size_limit',
        writableFormats: [],
        writableFields: [],
      });
    });

    it('drops the cover field for FB2 when the library disables cover writing', () => {
      const { service, registry } = makeService();
      registry.supports.mockImplementation((value: string) => value === 'fb2');

      const status = service.resolveBookFileWriteStatus(
        { ...DEFAULT_LIB_CONFIG, fileWriteWriteCover: false },
        [{ id: 1, format: 'fb2', sizeBytes: 1024 }],
        1,
      );

      expect(status.writableFields).not.toContain('coverBytes');
      expect(status.writableFields).toContain('seriesName');
    });

    it.each(['mobi', 'azw3', 'azw'])('returns the MOBI field set for %s files', (format) => {
      const { service, registry } = makeService();
      registry.supports.mockImplementation((value: string) => value === format);

      expect(service.resolveBookFileWriteStatus(DEFAULT_LIB_CONFIG, [{ id: 1, format, sizeBytes: 1024 }], 1)).toEqual({
        enabled: true,
        reason: null,
        writableFormats: [format],
        writableFields: [...MOBI_BOOK_FILE_WRITE_FIELDS],
      });
    });

    it.each(['mobi', 'azw3', 'azw'])('honours the shared Kindle enable toggle for %s', (format) => {
      const { service, registry } = makeService();
      registry.supports.mockImplementation((value: string) => value === format);

      expect(
        service.resolveBookFileWriteStatus({ ...DEFAULT_LIB_CONFIG, fileWriteKindleEnabled: false }, [{ id: 1, format, sizeBytes: 1024 }], 1),
      ).toEqual({
        enabled: false,
        reason: 'format_disabled',
        writableFormats: [],
        writableFields: [],
      });
    });

    it('honours the shared Kindle size limit', () => {
      const { service, registry } = makeService();
      registry.supports.mockImplementation((value: string) => value === 'azw3');

      expect(
        service.resolveBookFileWriteStatus(
          { ...DEFAULT_LIB_CONFIG, fileWriteKindleMaxFileSizeMb: 1 },
          [{ id: 1, format: 'azw3', sizeBytes: 2 * 1024 * 1024 }],
          1,
        ),
      ).toEqual({
        enabled: false,
        reason: 'file_exceeds_size_limit',
        writableFormats: [],
        writableFields: [],
      });
    });

    it('does not offer series or provider fields for Kindle files, since MOBI has no slot for them', () => {
      const { service, registry } = makeService();
      registry.supports.mockImplementation((value: string) => value === 'mobi');

      const status = service.resolveBookFileWriteStatus(DEFAULT_LIB_CONFIG, [{ id: 1, format: 'mobi', sizeBytes: 1024 }], 1);

      expect(status.writableFields).not.toContain('seriesName');
      expect(status.writableFields).not.toContain('seriesIndex');
      expect(status.writableFields).not.toContain('goodreadsId');
      expect(status.writableFields).not.toContain('rating');
    });

    it('excludes the cover for Kindle files when cover writing is disabled', () => {
      const { service, registry } = makeService();
      registry.supports.mockImplementation((value: string) => value === 'mobi');

      const status = service.resolveBookFileWriteStatus(
        { ...DEFAULT_LIB_CONFIG, fileWriteWriteCover: false },
        [{ id: 1, format: 'mobi', sizeBytes: 1024 }],
        1,
      );

      expect(status.writableFields).toEqual(MOBI_BOOK_FILE_WRITE_FIELDS.filter((field) => field !== 'coverBytes'));
    });
  });

  it('returns skip when no primary file exists', async () => {
    const { service, fileWriteRepo } = makeService();
    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue(null);

    await expect(service.writeToFile(1, 'auto')).resolves.toEqual({
      status: 'skipped',
      fieldsWritten: [],
      durationMs: 0,
      reason: 'no primary file',
    });
  });

  it('logs sync skip for unsupported format', async () => {
    const { service, fileWriteRepo, registry } = makeService();
    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/x.mobi',
      format: 'mobi',
      sizeBytes: 10,
      libraryId: 2,
    });
    registry.supports.mockReturnValue(false);

    const result = await service.writeToFile(10, 'sync', 7);

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('format not supported');
    expect(fileWriteRepo.insertLog).toHaveBeenCalledWith(
      expect.objectContaining({
        bookId: 10,
        bookFileId: 1,
        userId: 7,
        format: 'mobi',
        triggeredBy: 'sync',
      }),
    );
  });

  it('returns disabled when file write is off for the library (non-dry-run)', async () => {
    const { service, fileWriteRepo, writer } = makeService();
    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/x.epub',
      format: 'epub',
      sizeBytes: 10,
      libraryId: 2,
    });
    fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({ ...DEFAULT_LIB_CONFIG, fileWriteEnabled: false });

    const result = await service.writeToFile(10, 'auto');

    expect(result).toEqual({ status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'disabled' });
    expect(writer.write).not.toHaveBeenCalled();
  });

  it('skips when format exceeds max size and logs for sync trigger', async () => {
    const { service, fileWriteRepo } = makeService();
    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/x.pdf',
      format: 'pdf',
      sizeBytes: 500,
      libraryId: 2,
    });
    fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({
      ...DEFAULT_LIB_CONFIG,
      fileWritePdfMaxFileSizeMb: 0,
    });

    const result = await service.writeToFile(10, 'sync', 8);

    expect(result.reason).toBe('file exceeds size limit');
    expect(fileWriteRepo.insertLog).toHaveBeenCalledWith(
      expect.objectContaining({
        format: 'pdf',
        triggeredBy: 'sync',
        userId: 8,
      }),
    );
  });

  it('writes successfully with lock, cover loading, logging, and lastWrittenAt update', async () => {
    const { service, fileWriteRepo, writer, lockService } = makeService();

    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/lib/book.epub',
      format: 'epub',
      sizeBytes: 40,
      fileHash: 'oldhash',
      libraryId: 2,
    });
    fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Dune', authors: [{ name: 'Frank Herbert', sortName: null }] });
    fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({ ...DEFAULT_LIB_CONFIG, fileWriteWriteCover: true });

    const coverBytes = Buffer.from('cover');
    mockReaddir.mockResolvedValue(['cover_extracted.jpg', 'cover_custom.png'] as never);
    mockReadFile.mockResolvedValue(coverBytes as never);

    writer.write.mockResolvedValue({ status: 'success', fieldsWritten: ['title'], durationMs: 13 });

    const result = await service.writeToFile(5, 'auto');

    expect(result).toEqual({ status: 'success', fieldsWritten: ['title'], durationMs: 13 });
    expect(lockService.withLock).toHaveBeenCalledTimes(2);
    expect(lockService.withLock).toHaveBeenNthCalledWith(1, bookOperationLockKey(5), expect.any(Function));
    expect(writer.write).toHaveBeenCalledWith(
      '/books/lib/book.epub',
      expect.objectContaining({ title: 'Dune', coverBytes }),
      expect.objectContaining({ dryRun: false }),
    );
    expect(mockReadFile).toHaveBeenCalledWith('/books/covers/5/cover_custom.png');

    expect(fileWriteRepo.insertLog).toHaveBeenCalledTimes(1);
    expect(fileWriteRepo.setLastWrittenAt).toHaveBeenCalledWith(5, expect.any(Date));
    expect(fileWriteRepo.recordHashHistory).toHaveBeenCalledWith(1, 'oldhash', 'file_write');
  });

  it('updates file hash and scanner identity fields after successful write', async () => {
    const { service, fileWriteRepo, writer } = makeService();

    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/lib/book.epub',
      format: 'epub',
      sizeBytes: 40,
      fileHash: 'oldhash',
      libraryId: 2,
    });
    fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Book' });
    fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({ ...DEFAULT_LIB_CONFIG, fileWriteWriteCover: false });
    writer.write.mockResolvedValue({ status: 'success', fieldsWritten: ['title'], durationMs: 5 });
    computeFileHashMock.mockResolvedValue('newhash');

    await expect(service.writeToFile(5, 'auto')).resolves.toEqual({ status: 'success', fieldsWritten: ['title'], durationMs: 5 });

    expect(fileWriteRepo.updateFileStat).toHaveBeenCalledWith(1, {
      fileHash: 'newhash',
      mtime: POST_WRITE_MTIME,
      sizeBytes: 57,
      ino: 9_007_199_254_740_993n,
    });
    expect(fileWriteRepo.setLastWrittenAt).toHaveBeenCalledWith(5, expect.any(Date));
  });

  it('persists scanner identity fields when hash recomputation fails', async () => {
    const { service, fileWriteRepo, writer } = makeService();
    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/lib/book.epub',
      format: 'epub',
      sizeBytes: 40,
      fileHash: 'oldhash',
      libraryId: 2,
    });
    fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Book' });
    fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({ ...DEFAULT_LIB_CONFIG, fileWriteWriteCover: false });
    writer.write.mockResolvedValue({ status: 'success', fieldsWritten: ['title'], durationMs: 5 });

    await expect(service.writeToFile(5, 'auto')).resolves.toEqual({ status: 'success', fieldsWritten: ['title'], durationMs: 5 });

    expect(fileWriteRepo.updateFileStat).toHaveBeenCalledWith(1, {
      mtime: POST_WRITE_MTIME,
      sizeBytes: 57,
      ino: 9_007_199_254_740_993n,
    });
  });

  it('retries transient post-write stat failures before reporting success', async () => {
    const { service, fileWriteRepo, writer } = makeService();
    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/lib/book.epub',
      format: 'epub',
      sizeBytes: 40,
      fileHash: 'oldhash',
      libraryId: 2,
    });
    fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Book' });
    fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({ ...DEFAULT_LIB_CONFIG, fileWriteWriteCover: false });
    writer.write.mockResolvedValue({ status: 'success', fieldsWritten: ['title'], durationMs: 5 });
    mockStat.mockRejectedValueOnce(new Error('temporary stat failure'));

    await expect(service.writeToFile(5, 'auto')).resolves.toEqual({ status: 'success', fieldsWritten: ['title'], durationMs: 5 });

    expect(mockStat).toHaveBeenCalledTimes(2);
    expect(fileWriteRepo.updateFileStat).toHaveBeenCalledTimes(1);
  });

  it('retries transient scanner identity persistence failures before reporting success', async () => {
    const { service, fileWriteRepo, writer } = makeService();
    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/lib/book.epub',
      format: 'epub',
      sizeBytes: 40,
      fileHash: 'oldhash',
      libraryId: 2,
    });
    fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Book' });
    fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({ ...DEFAULT_LIB_CONFIG, fileWriteWriteCover: false });
    fileWriteRepo.updateFileStat.mockRejectedValueOnce(new Error('temporary database failure'));
    writer.write.mockResolvedValue({ status: 'success', fieldsWritten: ['title'], durationMs: 5 });

    await expect(service.writeToFile(5, 'auto')).resolves.toEqual({ status: 'success', fieldsWritten: ['title'], durationMs: 5 });

    expect(mockStat).toHaveBeenCalledTimes(2);
    expect(fileWriteRepo.updateFileStat).toHaveBeenCalledTimes(2);
    expect(fileWriteRepo.setLastWrittenAt).toHaveBeenCalledTimes(1);
  });

  it('keeps watcher events deferred through scanner identity persistence', async () => {
    const { service, fileWriteRepo, writer, selfWriteRegistry } = makeService();
    const path = '/books/lib/book.epub';
    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: path,
      format: 'epub',
      sizeBytes: 40,
      fileHash: 'oldhash',
      libraryId: 2,
    });
    fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Book' });
    fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({ ...DEFAULT_LIB_CONFIG, fileWriteWriteCover: false });
    writer.write.mockImplementation(() => {
      expect(selfWriteRegistry.isSuppressed(path)).toBe(true);
      return Promise.resolve({ status: 'success', fieldsWritten: ['title'], durationMs: 5 });
    });
    fileWriteRepo.updateFileStat.mockImplementation(() => {
      expect(selfWriteRegistry.isSuppressed(path)).toBe(true);
      return Promise.resolve();
    });

    await expect(service.writeToFile(5, 'auto')).resolves.toEqual({ status: 'success', fieldsWritten: ['title'], durationMs: 5 });

    expect(selfWriteRegistry.isSuppressed(path)).toBe(false);
  });

  it('reports and notifies a sync failure when scanner identity fields cannot be refreshed', async () => {
    const { service, fileWriteRepo, writer, notificationService } = makeService();
    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/lib/book.epub',
      format: 'epub',
      sizeBytes: 40,
      fileHash: 'oldhash',
      libraryId: 2,
    });
    fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Book' });
    fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({ ...DEFAULT_LIB_CONFIG, fileWriteWriteCover: false });
    writer.write.mockResolvedValue({ status: 'success', fieldsWritten: ['title'], durationMs: 5 });
    mockStat.mockRejectedValue(new Error('stat unavailable'));

    await expect(service.writeToFile(5, 'sync', 3)).resolves.toEqual({
      status: 'failed',
      fieldsWritten: ['title'],
      durationMs: expect.any(Number),
      reason: 'post-write file state refresh failed',
    });

    expect(mockStat).toHaveBeenCalledTimes(3);
    expect(fileWriteRepo.updateFileStat).not.toHaveBeenCalled();
    expect(fileWriteRepo.setLastWrittenAt).not.toHaveBeenCalled();
    expect(fileWriteRepo.insertLog).toHaveBeenCalledWith(
      expect.objectContaining({ result: expect.objectContaining({ status: 'failed', reason: 'post-write file state refresh failed' }) }),
    );
    expect(notificationService.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.FileWriteBackFailed,
        message: 'post-write file state refresh failed',
        scope: { kind: 'user', userId: 3 },
        meta: { bookId: 5 },
      }),
    );
  });

  it('returns skip when library config is not found', async () => {
    const { service, fileWriteRepo } = makeService();
    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/x.epub',
      format: 'epub',
      sizeBytes: 10,
      libraryId: 99,
    });
    fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue(null);

    const result = await service.writeToFile(5, 'auto');

    expect(result).toEqual({ status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'library not found' });
    expect(fileWriteRepo.insertLog).not.toHaveBeenCalled();
  });

  it('returns skip when metadata payload is missing', async () => {
    const { service, fileWriteRepo, writer } = makeService();
    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/x.epub',
      format: 'epub',
      sizeBytes: 10,
      libraryId: 2,
    });
    fileWriteRepo.loadPayload.mockResolvedValue(null);

    const result = await service.writeToFile(5, 'auto');

    expect(result).toEqual({ status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'no metadata' });
    expect(writer.write).not.toHaveBeenCalled();
  });

  it('skips defensively when a registered format has no write settings', async () => {
    const { service, fileWriteRepo, registry, writer } = makeService();
    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/x.custom',
      format: 'custom',
      sizeBytes: 10,
      libraryId: 2,
    });
    registry.supports.mockReturnValue(true);

    const result = await service.writeToFile(5, 'sync', 7);

    expect(result).toEqual({ status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'format disabled' });
    expect(fileWriteRepo.loadPayload).not.toHaveBeenCalled();
    expect(writer.write).not.toHaveBeenCalled();
  });

  it('skips with format disabled when cbz routes to cbx settings and cbx is off', async () => {
    const { service, fileWriteRepo } = makeService();
    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/x.cbz',
      format: 'cbz',
      sizeBytes: 100,
      libraryId: 2,
    });
    fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({
      ...DEFAULT_LIB_CONFIG,
      fileWriteCbxEnabled: false,
    });

    const result = await service.writeToFile(10, 'auto');

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('format disabled');
  });

  it('skips with format disabled when cb7 routes to cbx settings and cbx is off', async () => {
    const { service, fileWriteRepo } = makeService();
    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/x.cb7',
      format: 'cb7',
      sizeBytes: 100,
      libraryId: 2,
    });
    fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({
      ...DEFAULT_LIB_CONFIG,
      fileWriteCbxEnabled: false,
    });

    const result = await service.writeToFile(10, 'sync', 5);

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('format disabled');
    expect(fileWriteRepo.insertLog).toHaveBeenCalledWith(expect.objectContaining({ format: 'cb7', triggeredBy: 'sync' }));
  });

  it('skips when cbz file exceeds cbxMaxFileSizeMb', async () => {
    const { service, fileWriteRepo } = makeService();
    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/x.cbz',
      format: 'cbz',
      sizeBytes: 600 * 1024 * 1024,
      libraryId: 2,
    });
    fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({
      ...DEFAULT_LIB_CONFIG,
      fileWriteCbxEnabled: true,
      fileWriteCbxMaxFileSizeMb: 500,
      fileWriteKindleEnabled: true,
      fileWriteKindleMaxFileSizeMb: 100,
    });

    const result = await service.writeToFile(10, 'auto');

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('file exceeds size limit');
  });

  it('writes supported multi-track audio files and skips unsupported audio tracks explicitly', async () => {
    const { service, fileWriteRepo, registry, writer, lockService } = makeService();
    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/audio/book.m4b',
      format: 'm4b',
      sizeBytes: 100,
      fileHash: 'm4bhash',
      libraryId: 2,
    });
    fileWriteRepo.findFilesForBook.mockResolvedValue([
      { id: 1, absolutePath: '/books/audio/book.m4b', format: 'm4b', sizeBytes: 100, fileHash: 'm4bhash', libraryId: 2 },
      { id: 2, absolutePath: '/books/audio/track-02.mp3', format: 'mp3', sizeBytes: 110, fileHash: 'mp3hash', libraryId: 2 },
      { id: 3, absolutePath: '/books/audio/bonus.opus', format: 'opus', sizeBytes: 90, fileHash: 'opushash', libraryId: 2 },
    ]);
    registry.supports.mockImplementation((format: string) => ['m4b', 'mp3'].includes(format));
    fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Audio Book' });
    fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({ ...DEFAULT_LIB_CONFIG, fileWriteAudioEnabled: true, fileWriteWriteCover: true });
    mockReaddir.mockResolvedValue(['cover_custom.jpg'] as never);
    mockReadFile.mockResolvedValue(Buffer.from('cover') as never);
    writer.write.mockResolvedValue({ status: 'success', fieldsWritten: ['coverBytes'], durationMs: 5 });
    computeFileHashMock.mockResolvedValueOnce('new-m4b').mockResolvedValueOnce('new-mp3');

    const result = await service.writeToFile(20, 'sync', 7);

    expect(result.status).toBe('success');
    expect(result.fieldsWritten).toEqual(['coverBytes']);
    expect(fileWriteRepo.findFilesForBook).toHaveBeenCalledWith(20);
    expect(mockReadFile).toHaveBeenCalledTimes(1);
    expect(lockService.withLock).toHaveBeenCalledTimes(3);
    expect(lockService.withLock).toHaveBeenNthCalledWith(1, bookOperationLockKey(20), expect.any(Function));
    expect(writer.write).toHaveBeenNthCalledWith(
      1,
      '/books/audio/book.m4b',
      expect.objectContaining({ title: 'Audio Book', coverBytes: Buffer.from('cover') }),
      expect.objectContaining({ dryRun: false, isMultiTrackAudio: true, trackNumber: 1, trackTotal: 2, trackTitle: 'book' }),
    );
    expect(writer.write).toHaveBeenNthCalledWith(
      2,
      '/books/audio/track-02.mp3',
      expect.objectContaining({ title: 'Audio Book', coverBytes: Buffer.from('cover') }),
      expect.objectContaining({ dryRun: false, isMultiTrackAudio: true, trackNumber: 2, trackTotal: 2, trackTitle: 'track-02' }),
    );
    expect(fileWriteRepo.insertLog).toHaveBeenCalledTimes(3);
    expect(fileWriteRepo.insertLog).toHaveBeenCalledWith(
      expect.objectContaining({ bookFileId: 3, format: 'opus', result: expect.objectContaining({ reason: 'format not supported' }) }),
    );
    expect(fileWriteRepo.recordHashHistory).toHaveBeenNthCalledWith(1, 1, 'm4bhash', 'file_write');
    expect(fileWriteRepo.recordHashHistory).toHaveBeenNthCalledWith(2, 2, 'mp3hash', 'file_write');
    expect(fileWriteRepo.updateFileStat).toHaveBeenNthCalledWith(1, 1, expect.objectContaining({ fileHash: 'new-m4b' }));
    expect(fileWriteRepo.updateFileStat).toHaveBeenNthCalledWith(2, 2, expect.objectContaining({ fileHash: 'new-mp3' }));
    expect(fileWriteRepo.setLastWrittenAt).toHaveBeenCalledTimes(1);
  });

  it('skips audio when audio write-back is disabled', async () => {
    const { service, fileWriteRepo, writer } = makeService();
    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/audio/book.mp3',
      format: 'mp3',
      sizeBytes: 100,
      libraryId: 2,
    });
    fileWriteRepo.findFilesForBook.mockResolvedValue([{ id: 1, absolutePath: '/books/audio/book.mp3', format: 'mp3', sizeBytes: 100, libraryId: 2 }]);
    fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Audio Book' });
    fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({ ...DEFAULT_LIB_CONFIG, fileWriteAudioEnabled: false });

    const result = await service.writeToFile(20, 'sync', 7);

    expect(result).toEqual({ status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'format disabled' });
    expect(writer.write).not.toHaveBeenCalled();
    expect(fileWriteRepo.insertLog).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'mp3', result: expect.objectContaining({ reason: 'format disabled' }) }),
    );
  });

  it('skips audio when the file exceeds audio max size', async () => {
    const { service, fileWriteRepo, writer } = makeService();
    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/audio/book.flac',
      format: 'flac',
      sizeBytes: 600 * 1024 * 1024,
      libraryId: 2,
    });
    fileWriteRepo.findFilesForBook.mockResolvedValue([
      { id: 1, absolutePath: '/books/audio/book.flac', format: 'flac', sizeBytes: 600 * 1024 * 1024, libraryId: 2 },
    ]);
    fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Audio Book' });
    fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({
      ...DEFAULT_LIB_CONFIG,
      fileWriteAudioEnabled: true,
      fileWriteAudioMaxFileSizeMb: 500,
    });

    const result = await service.writeToFile(20, 'auto', 7);

    expect(result).toEqual({ status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'file exceeds size limit' });
    expect(writer.write).not.toHaveBeenCalled();
  });

  it('aggregates failed multi-track audio writes and does not mark the book written', async () => {
    const { service, fileWriteRepo, registry, writer } = makeService();
    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/audio/book.m4b',
      format: 'm4b',
      sizeBytes: 100,
      fileHash: 'm4bhash',
      libraryId: 2,
    });
    fileWriteRepo.findFilesForBook.mockResolvedValue([
      { id: 1, absolutePath: '/books/audio/book.m4b', format: 'm4b', sizeBytes: 100, fileHash: 'm4bhash', libraryId: 2 },
      { id: 2, absolutePath: '/books/audio/track-02.mp3', format: 'mp3', sizeBytes: 100, fileHash: 'mp3hash', libraryId: 2 },
    ]);
    registry.supports.mockImplementation((format: string) => ['m4b', 'mp3'].includes(format));
    fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Audio Book' });
    fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({ ...DEFAULT_LIB_CONFIG, fileWriteAudioEnabled: true, fileWriteWriteCover: true });
    mockReaddir.mockResolvedValue(['cover_custom.jpg'] as never);
    mockReadFile.mockResolvedValue(Buffer.from('cover') as never);
    writer.write.mockImplementation((filePath: string) => {
      if (filePath.endsWith('.mp3')) {
        return Promise.reject(new Error('mp3 write failed'));
      }
      return Promise.resolve({ status: 'success', fieldsWritten: ['coverBytes'], durationMs: 5 });
    });
    computeFileHashMock.mockResolvedValue('new-m4b');

    const result = await service.writeToFile(20, 'sync', 7);

    expect(result.status).toBe('failed');
    expect(result.reason).toBe('1 of 2 file writes failed');
    expect(result.fieldsWritten).toEqual(['coverBytes']);
    expect(fileWriteRepo.updateFileStat).toHaveBeenCalledWith(1, expect.objectContaining({ fileHash: 'new-m4b' }));
    expect(fileWriteRepo.setLastWrittenAt).not.toHaveBeenCalled();
    expect(fileWriteRepo.insertLog).toHaveBeenCalledWith(
      expect.objectContaining({
        bookFileId: 2,
        result: expect.objectContaining({ status: 'failed', reason: 'mp3 write failed' }),
      }),
    );
  });

  it('aggregates all-skipped multi-track audio reasons before loading metadata', async () => {
    const { service, fileWriteRepo, registry, writer } = makeService();
    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/audio/book.m4b',
      format: 'm4b',
      sizeBytes: 100,
      libraryId: 2,
    });
    fileWriteRepo.findFilesForBook.mockResolvedValue([
      { id: 1, absolutePath: '/books/audio/book.m4b', format: 'm4b', sizeBytes: 100, libraryId: 2 },
      { id: 2, absolutePath: '/books/audio/bonus.opus', format: 'opus', sizeBytes: 100, libraryId: 2 },
    ]);
    registry.supports.mockImplementation((format: string) => format === 'm4b');
    fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({ ...DEFAULT_LIB_CONFIG, fileWriteAudioEnabled: false });

    const result = await service.writeToFile(20, 'sync', 7);

    expect(result).toEqual({
      status: 'skipped',
      fieldsWritten: [],
      durationMs: expect.any(Number),
      reason: 'format disabled; format not supported',
    });
    expect(fileWriteRepo.loadPayload).not.toHaveBeenCalled();
    expect(writer.write).not.toHaveBeenCalled();
    expect(fileWriteRepo.insertLog).toHaveBeenCalledTimes(2);
  });

  it('keeps ogg and opus unsupported without loading payload or config', async () => {
    const { service, fileWriteRepo, registry } = makeService();
    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/audio/book.opus',
      format: 'opus',
      sizeBytes: 100,
      libraryId: 2,
    });
    fileWriteRepo.findFilesForBook.mockResolvedValue([
      { id: 1, absolutePath: '/books/audio/book.opus', format: 'opus', sizeBytes: 100, libraryId: 2 },
      { id: 2, absolutePath: '/books/audio/book.ogg', format: 'ogg', sizeBytes: 100, libraryId: 2 },
    ]);
    registry.supports.mockReturnValue(false);

    const result = await service.writeToFile(20, 'sync', 7);

    expect(result).toEqual({ status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'format not supported' });
    expect(fileWriteRepo.findLibraryFileWriteConfig).not.toHaveBeenCalled();
    expect(fileWriteRepo.loadPayload).not.toHaveBeenCalled();
    expect(fileWriteRepo.insertLog).toHaveBeenCalledTimes(2);
  });

  it('delegates log and library lookup helpers to the repository', async () => {
    const { service, fileWriteRepo } = makeService();
    fileWriteRepo.findWriteLog.mockResolvedValue([{ id: 1 }]);
    fileWriteRepo.findNonMissingPrimaryFilesByLibrary.mockResolvedValue([{ bookId: 2 }]);
    fileWriteRepo.findLibraryWriteSettingsForBook.mockResolvedValue({ fileWriteEnabled: true, fileRenameEnabled: false });

    await expect(service.findWriteLog(5, 10)).resolves.toEqual([{ id: 1 }]);
    await expect(service.findNonMissingPrimaryFilesByLibrary(7)).resolves.toEqual([{ bookId: 2 }]);
    await expect(service.findLibraryWriteSettingsForBook(9)).resolves.toEqual({ fileWriteEnabled: true, fileRenameEnabled: false });

    expect(fileWriteRepo.findWriteLog).toHaveBeenCalledWith(5, 10);
    expect(fileWriteRepo.findNonMissingPrimaryFilesByLibrary).toHaveBeenCalledWith(7);
    expect(fileWriteRepo.findLibraryWriteSettingsForBook).toHaveBeenCalledWith(9);
  });

  it('returns failed and logs when writer throws', async () => {
    const { service, fileWriteRepo, writer } = makeService();

    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/lib/book.cbz',
      format: 'cbz',
      sizeBytes: 40,
      libraryId: 2,
    });
    fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Dune' });
    fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({ ...DEFAULT_LIB_CONFIG, fileWriteCbxEnabled: true });
    writer.write.mockRejectedValue(new Error('zip broken'));

    const result = await service.writeToFile(5, 'sync', 3);

    expect(result).toEqual({ status: 'failed', fieldsWritten: [], durationMs: 0, reason: 'zip broken' });
    expect(fileWriteRepo.insertLog).toHaveBeenCalledWith(
      expect.objectContaining({
        triggeredBy: 'sync',
        result: expect.objectContaining({ status: 'failed', reason: 'zip broken' }),
      }),
    );
    expect(fileWriteRepo.setLastWrittenAt).not.toHaveBeenCalled();
  });

  it('dry-run bypasses disabled gate and avoids cover read', async () => {
    const { service, fileWriteRepo, writer } = makeService();

    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/lib/book.epub',
      format: 'epub',
      sizeBytes: 40,
      libraryId: 2,
    });
    fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Dune' });
    fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({ ...DEFAULT_LIB_CONFIG, fileWriteEnabled: false, fileWriteWriteCover: true });
    writer.write.mockResolvedValue({ status: 'skipped', fieldsWritten: ['title'], durationMs: 0, reason: 'dry-run' });

    const result = await service.writeToFile(5, 'auto', undefined, true);

    expect(result.status).toBe('skipped');
    expect(mockReaddir).not.toHaveBeenCalled();
    expect(writer.write).toHaveBeenCalledWith(
      '/books/lib/book.epub',
      expect.not.objectContaining({ coverBytes: expect.anything() }),
      expect.objectContaining({ dryRun: true }),
    );
  });

  it('debounces scheduled writes and clears timers on destroy', async () => {
    vi.useFakeTimers();
    const { service } = makeService();
    const spy = vi.spyOn(service, 'writeToFile').mockResolvedValue({ status: 'success', fieldsWritten: [], durationMs: 1 });

    service.scheduleWrite(11, 'auto');
    service.scheduleWrite(11, 'auto');
    service.scheduleWrite(12, 'sync', 9);

    vi.advanceTimersByTime(2999);
    expect(spy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await Promise.resolve();

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, 11, 'auto', undefined);
    expect(spy).toHaveBeenNthCalledWith(2, 12, 'sync', 9);

    service.scheduleWrite(50, 'auto');
    service.onModuleDestroy();
    vi.runAllTimers();
    await Promise.resolve();

    expect(spy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('uses configured debounce duration', async () => {
    vi.useFakeTimers();
    const { service } = makeService({ 'fileWrite.debounceMs': 1_000 });
    const spy = vi.spyOn(service, 'writeToFile').mockResolvedValue({ status: 'success', fieldsWritten: [], durationMs: 1 });

    service.scheduleWrite(21, 'auto');
    vi.advanceTimersByTime(999);
    expect(spy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('limits concurrent writes using configured max write slots', async () => {
    const { service, fileWriteRepo, writer } = makeService({ 'fileWrite.maxConcurrentWrites': 1 });
    fileWriteRepo.findPrimaryFileForBook.mockImplementation((bookId: number) => ({
      id: bookId,
      absolutePath: `/books/${bookId}.epub`,
      format: 'epub',
      sizeBytes: 40,
      libraryId: 2,
    }));
    fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Queued write' });
    fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({ ...DEFAULT_LIB_CONFIG, fileWriteWriteCover: false });

    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    writer.write.mockImplementation(async (path: string) => {
      order.push(`start:${path}`);
      if (path === '/books/1.epub') {
        await firstGate;
      }
      order.push(`end:${path}`);
      return { status: 'success', fieldsWritten: ['title'], durationMs: 1 };
    });

    const first = service.writeToFile(1, 'auto');
    const second = service.writeToFile(2, 'auto');

    await vi.waitFor(() => expect(writer.write).toHaveBeenCalledTimes(1));

    releaseFirst();
    await Promise.all([first, second]);

    expect(order).toEqual(['start:/books/1.epub', 'end:/books/1.epub', 'start:/books/2.epub', 'end:/books/2.epub']);
  });

  describe('force parameter', () => {
    it('bypasses fileWriteEnabled=false when force=true', async () => {
      const { service, fileWriteRepo, writer } = makeService();
      fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
        id: 1,
        absolutePath: '/books/lib/book.epub',
        format: 'epub',
        sizeBytes: 40,
        libraryId: 2,
      });
      fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Dune' });
      fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({ ...DEFAULT_LIB_CONFIG, fileWriteEnabled: false, fileWriteWriteCover: false });
      writer.write.mockResolvedValue({ status: 'success', fieldsWritten: ['title'], durationMs: 5 });

      const result = await service.writeToFile(5, 'sync', 1, false, true);

      expect(result.status).toBe('success');
      expect(writer.write).toHaveBeenCalled();
    });

    it('returns disabled when force=false and fileWriteEnabled=false', async () => {
      const { service, fileWriteRepo, writer } = makeService();
      fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
        id: 1,
        absolutePath: '/books/x.epub',
        format: 'epub',
        sizeBytes: 10,
        libraryId: 2,
      });
      fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({ ...DEFAULT_LIB_CONFIG, fileWriteEnabled: false });

      const result = await service.writeToFile(5, 'sync', 1, false, false);

      expect(result).toEqual({ status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'disabled' });
      expect(writer.write).not.toHaveBeenCalled();
    });

    it('still skips when format is disabled even with force=true', async () => {
      const { service, fileWriteRepo, writer } = makeService();
      fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
        id: 1,
        absolutePath: '/books/x.pdf',
        format: 'pdf',
        sizeBytes: 10,
        libraryId: 2,
      });
      fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({ ...DEFAULT_LIB_CONFIG, fileWriteEnabled: false, fileWritePdfEnabled: false });

      const result = await service.writeToFile(5, 'sync', 1, false, true);

      expect(result).toEqual({ status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'format disabled' });
      expect(writer.write).not.toHaveBeenCalled();
    });

    it('still skips when file exceeds size limit even with force=true', async () => {
      const { service, fileWriteRepo, writer } = makeService();
      fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
        id: 1,
        absolutePath: '/books/big.epub',
        format: 'epub',
        sizeBytes: 200 * 1024 * 1024,
        libraryId: 2,
      });
      fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({ ...DEFAULT_LIB_CONFIG, fileWriteEnabled: false, fileWriteEpubMaxFileSizeMb: 100 });

      const result = await service.writeToFile(5, 'sync', 1, false, true);

      expect(result.status).toBe('skipped');
      expect(result.reason).toBe('file exceeds size limit');
      expect(writer.write).not.toHaveBeenCalled();
    });
  });

  describe('suppressNotification parameter', () => {
    it('does not send success notification when suppressNotification=true', async () => {
      const { fileWriteRepo, writer } = makeService();
      const notificationService = { notify: vi.fn().mockResolvedValue(undefined) };
      const serviceWithNotif = new (FileWriteService as never)(
        fileWriteRepo as never,
        { supports: vi.fn().mockReturnValue(true), get: vi.fn().mockReturnValue(writer) } as never,
        { withLock: vi.fn().mockImplementation(async (_: string, fn: () => Promise<unknown>) => fn()) } as never,
        { get: vi.fn().mockImplementation((key: string) => (key === 'storage.appDataPath' ? '/books' : undefined)) } as unknown as ConfigService,
        notificationService as never,
        new SelfWriteRegistry(),
      );

      fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
        id: 1,
        absolutePath: '/books/lib/book.epub',
        format: 'epub',
        sizeBytes: 40,
        libraryId: 2,
      });
      fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Dune' });
      fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({ ...DEFAULT_LIB_CONFIG, fileWriteWriteCover: false });
      writer.write.mockResolvedValue({ status: 'success', fieldsWritten: ['title'], durationMs: 5 });

      await serviceWithNotif.writeToFile(5, 'sync', 1, false, false, true);

      expect(notificationService.notify).not.toHaveBeenCalled();
    });

    it('does not send failure notification when suppressNotification=true', async () => {
      const { fileWriteRepo, writer } = makeService();
      const notificationService = { notify: vi.fn().mockResolvedValue(undefined) };
      const serviceWithNotif = new (FileWriteService as never)(
        fileWriteRepo as never,
        { supports: vi.fn().mockReturnValue(true), get: vi.fn().mockReturnValue(writer) } as never,
        { withLock: vi.fn().mockImplementation(async (_: string, fn: () => Promise<unknown>) => fn()) } as never,
        { get: vi.fn().mockImplementation((key: string) => (key === 'storage.appDataPath' ? '/books' : undefined)) } as unknown as ConfigService,
        notificationService as never,
        new SelfWriteRegistry(),
      );

      fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
        id: 1,
        absolutePath: '/books/lib/book.epub',
        format: 'epub',
        sizeBytes: 40,
        libraryId: 2,
      });
      fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Dune' });
      fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({ ...DEFAULT_LIB_CONFIG, fileWriteWriteCover: false });
      writer.write.mockRejectedValue(new Error('disk full'));

      await serviceWithNotif.writeToFile(5, 'sync', 1, false, false, true);

      expect(notificationService.notify).not.toHaveBeenCalled();
    });
  });

  describe('cancelPendingWrite', () => {
    it('clears the debounce timer so the write does not fire', async () => {
      vi.useFakeTimers();
      const { service } = makeService();
      const spy = vi.spyOn(service, 'writeToFile').mockResolvedValue({ status: 'success', fieldsWritten: [], durationMs: 1 });

      service.scheduleWrite(99, 'auto');
      service.cancelPendingWrite(99);

      vi.runAllTimers();
      await Promise.resolve();

      expect(spy).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('is a no-op when no timer is pending', () => {
      const { service } = makeService();
      expect(() => service.cancelPendingWrite(42)).not.toThrow();
    });
  });
});
