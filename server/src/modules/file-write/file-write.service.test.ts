import { ConfigService } from '@nestjs/config';
import type { MockedFunction } from 'vitest';
import { readFile, stat } from 'fs/promises';
import {
  AUDIO_BOOK_FILE_WRITE_FIELDS,
  EPUB_BOOK_FILE_WRITE_FIELDS,
  FB2_BOOK_FILE_WRITE_FIELDS,
  MOBI_BOOK_FILE_WRITE_FIELDS,
  NotificationType,
} from '@bookorbit/types';
import { SelfWriteRegistry } from '../../common/services/self-write-registry.service';

const { computeFileHashMock, inspectCoverImageMock } = vi.hoisted(() => ({
  computeFileHashMock: vi.fn(),
  inspectCoverImageMock: vi.fn(),
}));

vi.mock('../scanner/lib/hash', () => ({
  computeFileHash: computeFileHashMock,
}));

vi.mock('./formats/shared/cover-image', () => ({
  inspectCoverImage: inspectCoverImageMock,
}));

import { FileWriteService } from './file-write.service';
import { bookOperationLockKey } from './file-lock.service';

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual('fs/promises');
  return {
    ...actual,
    readFile: vi.fn(),
    stat: vi.fn(),
  };
});

const mockReadFile = readFile as MockedFunction<typeof readFile>;
const mockStat = stat as MockedFunction<typeof stat>;
const POST_WRITE_MTIME = new Date('2026-07-22T12:34:56.789Z');
/** Size on disk per path; anything not listed is 57 bytes. The service checks it before writing. */
const diskSizes = new Map<string, number>();
const statResult = (size: number) => ({ mtime: POST_WRITE_MTIME, size: BigInt(size), ino: 9_007_199_254_740_993n }) as never;

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
  fileWriteAllFiles: false,
  fileWriteReadAlongEnabled: false,
  fileWriteReadAlongMaxFileSizeMb: 1000,
};

describe('FileWriteService', () => {
  function makeService(configValues: Record<string, unknown> = {}, coverStore = { resolve: vi.fn().mockResolvedValue(null) }) {
    const fileWriteRepo = {
      findPrimaryFileForBook: vi.fn(),
      findFilesForBook: vi.fn(),
      findFileWriteScopeForBook: vi.fn().mockResolvedValue(null),
      findLibraryFileWriteConfig: vi.fn().mockResolvedValue({ ...DEFAULT_LIB_CONFIG }),
      loadPayload: vi.fn(),
      findWriteLog: vi.fn(),
      findNonMissingPrimaryFilesByLibrary: vi.fn(),
      findLibraryWriteSettingsForBook: vi.fn(),
      insertLog: vi.fn().mockResolvedValue(undefined),
      setLastWrittenAt: vi.fn().mockResolvedValue(undefined),
      updateFileStateAfterMetadataWrite: vi.fn().mockResolvedValue(undefined),
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
      get: vi.fn().mockImplementation((key: string) => configValues[key]),
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
      coverStore as never,
    );

    return { service, fileWriteRepo, registry, writer, lockService, notificationService, selfWriteRegistry, coverStore };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockReset();
    mockStat.mockReset();
    diskSizes.clear();
    mockStat.mockImplementation((path) => Promise.resolve(statResult(diskSizes.get(String(path)) ?? 57)));
    computeFileHashMock.mockReset();
    computeFileHashMock.mockRejectedValue(new Error('missing file'));
    inspectCoverImageMock.mockReset();
    inspectCoverImageMock.mockResolvedValue({ mediaType: 'image/jpeg', extension: 'jpg' });
  });

  describe('resolveBookFileWriteStatus', () => {
    it('returns enabled for a writable primary file', () => {
      const { service } = makeService();

      expect(service.resolveBookFileWriteStatus(DEFAULT_LIB_CONFIG, [{ id: 1, format: 'epub', sizeBytes: 1024 }], 1)).toMatchObject({
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
      ).toMatchObject({
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
            { id: 1, format: 'mp3', sizeBytes: 1024, role: 'content' },
            { id: 2, format: 'm4b', sizeBytes: 2048, role: 'content' },
            { id: 3, format: 'opus', sizeBytes: 4096, role: 'content' },
          ],
          1,
        ),
      ).toMatchObject({
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
      ).toMatchObject({
        enabled: false,
        reason: 'file_exceeds_size_limit',
        writableFormats: [],
        writableFields: [],
      });
    });

    it('returns the FB2 field set for fb2 files', () => {
      const { service, registry } = makeService();
      registry.supports.mockImplementation((value: string) => value === 'fb2');

      expect(service.resolveBookFileWriteStatus(DEFAULT_LIB_CONFIG, [{ id: 1, format: 'fb2', sizeBytes: 1024 }], 1)).toMatchObject({
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
      ).toMatchObject({
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
      ).toMatchObject({
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

      expect(service.resolveBookFileWriteStatus(DEFAULT_LIB_CONFIG, [{ id: 1, format, sizeBytes: 1024 }], 1)).toMatchObject({
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
      ).toMatchObject({
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
      ).toMatchObject({
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
    const { service, fileWriteRepo, writer, lockService, coverStore } = makeService();

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
    coverStore.resolve.mockResolvedValue('/books/covers/5/ebook/cover_custom.png');
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
    expect(mockReadFile).toHaveBeenCalledWith('/books/covers/5/ebook/cover_custom.png');

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

    expect(fileWriteRepo.updateFileStateAfterMetadataWrite).toHaveBeenCalledWith(5, 1, 'oldhash', {
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

    expect(fileWriteRepo.updateFileStateAfterMetadataWrite).toHaveBeenCalledWith(5, 1, 'oldhash', {
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
    mockStat.mockResolvedValueOnce(statResult(40)).mockRejectedValueOnce(new Error('temporary stat failure'));

    await expect(service.writeToFile(5, 'auto')).resolves.toEqual({ status: 'success', fieldsWritten: ['title'], durationMs: 5 });

    // One pre-write size check, then a failed and a successful post-write refresh.
    expect(mockStat).toHaveBeenCalledTimes(3);
    expect(fileWriteRepo.updateFileStateAfterMetadataWrite).toHaveBeenCalledTimes(1);
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
    fileWriteRepo.updateFileStateAfterMetadataWrite.mockRejectedValueOnce(new Error('temporary database failure'));
    writer.write.mockResolvedValue({ status: 'success', fieldsWritten: ['title'], durationMs: 5 });

    await expect(service.writeToFile(5, 'auto')).resolves.toEqual({ status: 'success', fieldsWritten: ['title'], durationMs: 5 });

    // One pre-write size check, then two post-write refresh attempts.
    expect(mockStat).toHaveBeenCalledTimes(3);
    expect(fileWriteRepo.updateFileStateAfterMetadataWrite).toHaveBeenCalledTimes(2);
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
    fileWriteRepo.updateFileStateAfterMetadataWrite.mockImplementation(() => {
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

    // The pre-write size check falls back to the stored size, then all three refresh attempts fail.
    expect(mockStat).toHaveBeenCalledTimes(4);
    expect(fileWriteRepo.updateFileStateAfterMetadataWrite).not.toHaveBeenCalled();
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
    diskSizes.set('/books/x.cbz', 600 * 1024 * 1024);
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

  it('embeds only the book cover into an EPUB, never the audiobook cover', async () => {
    const coverStore = { resolve: vi.fn().mockResolvedValue('/books/covers/5/ebook/cover_extracted.jpg') };
    const { service, fileWriteRepo, writer } = makeService({}, coverStore);
    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/lib/book.epub',
      format: 'epub',
      sizeBytes: 40,
      fileHash: 'oldhash',
      libraryId: 2,
    });
    fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Dune' });
    fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({ ...DEFAULT_LIB_CONFIG, fileWriteWriteCover: true });
    mockReadFile.mockResolvedValue(Buffer.from('portrait') as never);
    writer.write.mockResolvedValue({ status: 'success', fieldsWritten: ['coverBytes'], durationMs: 5 });

    await service.writeToFile(5, 'auto');

    expect(coverStore.resolve).toHaveBeenCalledWith(5, { medium: 'ebook', variant: 'cover', strict: true });
    expect(mockReadFile).toHaveBeenCalledWith('/books/covers/5/ebook/cover_extracted.jpg');
    expect(writer.write).toHaveBeenCalledWith(
      '/books/lib/book.epub',
      expect.objectContaining({ coverBytes: Buffer.from('portrait') }),
      expect.anything(),
    );
  });

  it('writes no cover into audio tracks when the book has no audiobook cover of its own', async () => {
    const coverStore = { resolve: vi.fn().mockResolvedValue(null) };
    const { service, fileWriteRepo, writer } = makeService({}, coverStore);
    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/audio/book.m4b',
      format: 'm4b',
      sizeBytes: 100,
      fileHash: 'm4bhash',
      libraryId: 2,
    });
    fileWriteRepo.findFilesForBook.mockResolvedValue([
      { id: 1, absolutePath: '/books/audio/book.m4b', format: 'm4b', sizeBytes: 100, fileHash: 'm4bhash', libraryId: 2, role: 'content' },
    ]);
    fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Audio Book' });
    fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({ ...DEFAULT_LIB_CONFIG, fileWriteAudioEnabled: true, fileWriteWriteCover: true });
    writer.write.mockResolvedValue({ status: 'success', fieldsWritten: ['title'], durationMs: 5 });

    await service.writeToFile(20, 'auto');

    expect(coverStore.resolve).toHaveBeenCalledWith(20, { medium: 'audio', variant: 'cover', strict: true });
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(writer.write).toHaveBeenCalledWith('/books/audio/book.m4b', expect.objectContaining({ coverBytes: null }), expect.anything());
  });

  it('writes supported multi-track audio files and skips unsupported audio tracks explicitly', async () => {
    const { service, fileWriteRepo, registry, writer, lockService, coverStore } = makeService();
    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/audio/book.m4b',
      format: 'm4b',
      sizeBytes: 100,
      fileHash: 'm4bhash',
      libraryId: 2,
    });
    fileWriteRepo.findFilesForBook.mockResolvedValue([
      {
        id: 1,
        absolutePath: '/books/audio/book.m4b',
        format: 'm4b',
        sizeBytes: 100,
        fileHash: 'm4bhash',
        libraryId: 2,
        role: 'content',
        sortOrder: 0,
      },
      {
        id: 2,
        absolutePath: '/books/audio/track-02.mp3',
        format: 'mp3',
        sizeBytes: 110,
        fileHash: 'mp3hash',
        libraryId: 2,
        role: 'content',
        sortOrder: 1,
      },
      {
        id: 3,
        absolutePath: '/books/audio/bonus.opus',
        format: 'opus',
        sizeBytes: 90,
        fileHash: 'opushash',
        libraryId: 2,
        role: 'content',
        sortOrder: 2,
      },
    ]);
    registry.supports.mockImplementation((format: string) => ['m4b', 'mp3'].includes(format));
    fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Audio Book' });
    fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({ ...DEFAULT_LIB_CONFIG, fileWriteAudioEnabled: true, fileWriteWriteCover: true });
    coverStore.resolve.mockResolvedValue('/books/covers/20/audio/cover_custom.jpg');
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
    // The unsupported opus track still holds position 3, so the total counts the whole recording.
    expect(writer.write).toHaveBeenNthCalledWith(
      1,
      '/books/audio/book.m4b',
      expect.objectContaining({ title: 'Audio Book', coverBytes: Buffer.from('cover') }),
      expect.objectContaining({ dryRun: false, isMultiTrackAudio: true, trackNumber: 1, trackTotal: 3, trackTitle: 'book' }),
    );
    expect(writer.write).toHaveBeenNthCalledWith(
      2,
      '/books/audio/track-02.mp3',
      expect.objectContaining({ title: 'Audio Book', coverBytes: Buffer.from('cover') }),
      expect.objectContaining({ dryRun: false, isMultiTrackAudio: true, trackNumber: 2, trackTotal: 3, trackTitle: 'track-02' }),
    );
    expect(fileWriteRepo.insertLog).toHaveBeenCalledTimes(3);
    expect(fileWriteRepo.insertLog).toHaveBeenCalledWith(
      expect.objectContaining({ bookFileId: 3, format: 'opus', result: expect.objectContaining({ reason: 'format not supported' }) }),
    );
    expect(fileWriteRepo.recordHashHistory).toHaveBeenNthCalledWith(1, 1, 'm4bhash', 'file_write');
    expect(fileWriteRepo.recordHashHistory).toHaveBeenNthCalledWith(2, 2, 'mp3hash', 'file_write');
    expect(fileWriteRepo.updateFileStateAfterMetadataWrite).toHaveBeenNthCalledWith(
      1,
      20,
      1,
      'm4bhash',
      expect.objectContaining({ fileHash: 'new-m4b' }),
    );
    expect(fileWriteRepo.updateFileStateAfterMetadataWrite).toHaveBeenNthCalledWith(
      2,
      20,
      2,
      'mp3hash',
      expect.objectContaining({ fileHash: 'new-mp3' }),
    );
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
    fileWriteRepo.findFilesForBook.mockResolvedValue([
      { id: 1, absolutePath: '/books/audio/book.mp3', format: 'mp3', sizeBytes: 100, libraryId: 2, role: 'content' },
    ]);
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
    diskSizes.set('/books/audio/book.flac', 600 * 1024 * 1024);
    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/audio/book.flac',
      format: 'flac',
      sizeBytes: 600 * 1024 * 1024,
      libraryId: 2,
    });
    fileWriteRepo.findFilesForBook.mockResolvedValue([
      { id: 1, absolutePath: '/books/audio/book.flac', format: 'flac', sizeBytes: 600 * 1024 * 1024, libraryId: 2, role: 'content' },
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
    const { service, fileWriteRepo, registry, writer, coverStore } = makeService();
    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/audio/book.m4b',
      format: 'm4b',
      sizeBytes: 100,
      fileHash: 'm4bhash',
      libraryId: 2,
    });
    fileWriteRepo.findFilesForBook.mockResolvedValue([
      { id: 1, absolutePath: '/books/audio/book.m4b', format: 'm4b', sizeBytes: 100, fileHash: 'm4bhash', libraryId: 2, role: 'content' },
      { id: 2, absolutePath: '/books/audio/track-02.mp3', format: 'mp3', sizeBytes: 100, fileHash: 'mp3hash', libraryId: 2, role: 'content' },
    ]);
    registry.supports.mockImplementation((format: string) => ['m4b', 'mp3'].includes(format));
    fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Audio Book' });
    fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({ ...DEFAULT_LIB_CONFIG, fileWriteAudioEnabled: true, fileWriteWriteCover: true });
    coverStore.resolve.mockResolvedValue('/books/covers/20/audio/cover_custom.jpg');
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
    expect(fileWriteRepo.updateFileStateAfterMetadataWrite).toHaveBeenCalledWith(20, 1, 'm4bhash', expect.objectContaining({ fileHash: 'new-m4b' }));
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
      { id: 1, absolutePath: '/books/audio/book.m4b', format: 'm4b', sizeBytes: 100, libraryId: 2, role: 'content', sortOrder: 0 },
      { id: 2, absolutePath: '/books/audio/bonus.opus', format: 'opus', sizeBytes: 100, libraryId: 2, role: 'content', sortOrder: 1 },
    ]);
    registry.supports.mockImplementation((format: string) => format === 'm4b');
    fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({ ...DEFAULT_LIB_CONFIG, fileWriteAudioEnabled: false });

    const result = await service.writeToFile(20, 'sync', 7);

    expect(result).toEqual({
      status: 'skipped',
      fieldsWritten: [],
      durationMs: expect.any(Number),
      reason: 'format disabled; format not supported',
      fileCounts: { processed: 2, succeeded: 0, failed: 0, skipped: 2 },
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
      { id: 1, absolutePath: '/books/audio/book.opus', format: 'opus', sizeBytes: 100, libraryId: 2, role: 'content' },
      { id: 2, absolutePath: '/books/audio/book.ogg', format: 'ogg', sizeBytes: 100, libraryId: 2, role: 'content' },
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

  it('stores and notifies a short, path-free reason when an external tool fails', async () => {
    const { service, fileWriteRepo, writer, notificationService } = makeService();
    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/lib/Author/book.m4b',
      format: 'm4b',
      sizeBytes: 40,
      libraryId: 2,
    });
    fileWriteRepo.findFilesForBook.mockResolvedValue([
      { id: 1, absolutePath: '/books/lib/Author/book.m4b', format: 'm4b', sizeBytes: 40, libraryId: 2, role: 'content' },
    ]);
    fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Book', description: 'A long description' });
    writer.write.mockRejectedValue(
      Object.assign(
        new Error('Command failed: ffmpeg -i /books/lib/Author/book.m4b -metadata description=A long description /books/lib/Author/.tmp.m4b'),
        {
          stderr: 'Error opening input file /books/lib/Author/book.m4b.\nError opening input files: Invalid data found when processing input',
        },
      ),
    );

    const result = await service.writeToFile(5, 'sync', 3);

    const expected = 'Error opening input file book.m4b. Error opening input files: Invalid data found when processing input';
    expect(result.reason).toBe(expected);
    expect(fileWriteRepo.insertLog).toHaveBeenCalledWith(expect.objectContaining({ result: expect.objectContaining({ reason: expected }) }));
    expect(notificationService.notify).toHaveBeenCalledWith(expect.objectContaining({ message: expected }));
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
    const { service, fileWriteRepo, writer, coverStore } = makeService();

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
    expect(coverStore.resolve).not.toHaveBeenCalled();
    expect(mockReadFile).not.toHaveBeenCalled();
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
      diskSizes.set('/books/big.epub', 200 * 1024 * 1024);
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
        { get: vi.fn() } as unknown as ConfigService,
        notificationService as never,
        new SelfWriteRegistry(),
        { resolve: vi.fn().mockResolvedValue(null) } as never,
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
        { get: vi.fn() } as unknown as ConfigService,
        notificationService as never,
        new SelfWriteRegistry(),
        { resolve: vi.fn().mockResolvedValue(null) } as never,
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

  describe('all-files write-back', () => {
    const ALL_FILES_CONFIG = { ...DEFAULT_LIB_CONFIG, fileWriteAllFiles: true };
    const epubRow = {
      id: 1,
      absolutePath: '/books/lib/book.epub',
      format: 'epub',
      sizeBytes: 40,
      fileHash: 'e',
      libraryId: 2,
      role: 'content',
      sortOrder: 0,
    };
    const m4bRow = {
      id: 2,
      absolutePath: '/books/lib/book.m4b',
      format: 'm4b',
      sizeBytes: 100,
      fileHash: 'a',
      libraryId: 2,
      role: 'content',
      sortOrder: 1,
    };
    const primaryOf = (row: typeof epubRow, fileWriteAllFiles = true) => ({
      id: row.id,
      absolutePath: row.absolutePath,
      format: row.format,
      sizeBytes: row.sizeBytes,
      fileHash: row.fileHash,
      libraryId: row.libraryId,
      fileWriteAllFiles,
    });

    function arrange(files: unknown[], options: { primary?: unknown; config?: Record<string, unknown> } = {}) {
      const context = makeService();
      context.fileWriteRepo.findPrimaryFileForBook.mockResolvedValue('primary' in options ? options.primary : primaryOf(epubRow));
      context.fileWriteRepo.findFilesForBook.mockResolvedValue(files);
      context.fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({ ...ALL_FILES_CONFIG, ...options.config });
      context.fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Book' });
      context.writer.write.mockResolvedValue({ status: 'success', fieldsWritten: ['title'], durationMs: 5 });
      return context;
    }

    const writtenPaths = (writer: { write: ReturnType<typeof vi.fn> }) => writer.write.mock.calls.map(([path]) => path);
    const optionsFor = (writer: { write: ReturnType<typeof vi.fn> }, path: string) =>
      writer.write.mock.calls.find(([called]) => called === path)?.[2];
    const payloadFor = (writer: { write: ReturnType<typeof vi.fn> }, path: string) =>
      writer.write.mock.calls.find(([called]) => called === path)?.[1];

    it('leaves the audiobook sibling alone while the flag is off', async () => {
      const { service, fileWriteRepo, writer } = arrange([epubRow, m4bRow], { primary: primaryOf(epubRow, false) });

      await service.writeToFile(5, 'auto');

      expect(fileWriteRepo.findFilesForBook).not.toHaveBeenCalled();
      expect(writtenPaths(writer)).toEqual(['/books/lib/book.epub']);
    });

    it('writes an ebook and its audiobook, each with its own medium cover', async () => {
      const { service, writer, coverStore } = arrange([epubRow, m4bRow]);
      coverStore.resolve.mockImplementation((_bookId: number, { medium }: { medium: string }) => Promise.resolve(`/covers/${medium}.jpg`));
      mockReadFile.mockImplementation(((path: string) => Promise.resolve(Buffer.from(path))) as never);

      const result = await service.writeToFile(5, 'auto');

      expect(writtenPaths(writer)).toEqual(['/books/lib/book.epub', '/books/lib/book.m4b']);
      expect(payloadFor(writer, '/books/lib/book.epub')).toMatchObject({ coverBytes: Buffer.from('/covers/ebook.jpg') });
      expect(payloadFor(writer, '/books/lib/book.m4b')).toMatchObject({ coverBytes: Buffer.from('/covers/audio.jpg') });
      expect(coverStore.resolve).toHaveBeenCalledTimes(2);
      expect(coverStore.resolve).toHaveBeenCalledWith(5, { medium: 'ebook', variant: 'cover', strict: true });
      expect(coverStore.resolve).toHaveBeenCalledWith(5, { medium: 'audio', variant: 'cover', strict: true });
      expect(result).toMatchObject({ status: 'success', fileCounts: { processed: 2, succeeded: 2, failed: 0, skipped: 0 } });
    });

    it('keeps the audiobook art and still writes its metadata when the book has no audiobook cover', async () => {
      const { service, writer, coverStore } = arrange([epubRow, m4bRow]);
      coverStore.resolve.mockImplementation((_bookId: number, { medium }: { medium: string }) =>
        Promise.resolve(medium === 'ebook' ? '/covers/ebook.jpg' : null),
      );
      mockReadFile.mockResolvedValue(Buffer.from('portrait') as never);

      await service.writeToFile(5, 'auto');

      expect(payloadFor(writer, '/books/lib/book.m4b')).toMatchObject({ title: 'Book', coverBytes: null });
      expect(payloadFor(writer, '/books/lib/book.epub')).toMatchObject({ coverBytes: Buffer.from('portrait') });
    });

    it('writes metadata without art when a cover slot cannot be decoded', async () => {
      const { service, writer, coverStore } = arrange([epubRow, m4bRow]);
      coverStore.resolve.mockImplementation((_bookId: number, { medium }: { medium: string }) => Promise.resolve(`/covers/${medium}.jpg`));
      mockReadFile.mockResolvedValue(Buffer.from('not an image') as never);
      inspectCoverImageMock.mockRejectedValue(new Error('Input buffer contains unsupported image format'));

      const result = await service.writeToFile(5, 'auto');

      expect(result).toMatchObject({ status: 'success', fileCounts: { processed: 2, succeeded: 2, failed: 0, skipped: 0 } });
      expect(payloadFor(writer, '/books/lib/book.epub')).toMatchObject({ title: 'Book', coverBytes: null });
      expect(payloadFor(writer, '/books/lib/book.m4b')).toMatchObject({ title: 'Book', coverBytes: null });
    });

    it('never embeds an empty cover file', async () => {
      const { service, writer, coverStore } = arrange([epubRow]);
      coverStore.resolve.mockResolvedValue('/covers/ebook.jpg');
      mockReadFile.mockResolvedValue(Buffer.alloc(0) as never);

      await service.writeToFile(5, 'auto');

      expect(payloadFor(writer, '/books/lib/book.epub')).toMatchObject({ coverBytes: null });
    });

    it('skips a supplement with an explicit reason', async () => {
      const workbook = {
        id: 3,
        absolutePath: '/books/lib/workbook.pdf',
        format: 'pdf',
        sizeBytes: 40,
        libraryId: 2,
        role: 'supplement',
        sortOrder: 2,
      };
      const { service, fileWriteRepo, writer } = arrange([epubRow, workbook]);

      const result = await service.writeToFile(5, 'sync', 7);

      expect(writtenPaths(writer)).toEqual(['/books/lib/book.epub']);
      expect(fileWriteRepo.insertLog).toHaveBeenCalledWith(
        expect.objectContaining({
          bookFileId: 3,
          format: 'pdf',
          result: expect.objectContaining({ status: 'skipped', reason: 'not a content file' }),
        }),
      );
      expect(result).toMatchObject({ status: 'success', fileCounts: { processed: 2, succeeded: 1, failed: 0, skipped: 1 } });
    });

    it('writes the audiobook beside an unsupported primary, with the book title', async () => {
      const djvuRow = { ...epubRow, absolutePath: '/books/lib/book.djvu', format: 'djvu' };
      const { service, writer, registry } = arrange([djvuRow, m4bRow], { primary: primaryOf(djvuRow) });
      registry.supports.mockImplementation((format: string) => format !== 'djvu');

      await service.writeToFile(5, 'auto');

      expect(writtenPaths(writer)).toEqual(['/books/lib/book.m4b']);
      expect(optionsFor(writer, '/books/lib/book.m4b')).toMatchObject({ isMultiTrackAudio: false });
    });

    it('writes a book that has no primary file', async () => {
      const { service, fileWriteRepo, writer } = arrange([epubRow], { primary: null });
      fileWriteRepo.findFileWriteScopeForBook.mockResolvedValue({ libraryId: 2, fileWriteAllFiles: true });

      await expect(service.writeToFile(5, 'auto')).resolves.toMatchObject({ status: 'success' });

      expect(fileWriteRepo.findLibraryFileWriteConfig).toHaveBeenCalledWith(2);
      expect(writtenPaths(writer)).toEqual(['/books/lib/book.epub']);
    });

    it('still reports no primary file for a book without one while the flag is off', async () => {
      const { service, fileWriteRepo, writer } = arrange([epubRow], { primary: null });
      fileWriteRepo.findFileWriteScopeForBook.mockResolvedValue({ libraryId: 2, fileWriteAllFiles: false });

      await expect(service.writeToFile(5, 'auto')).resolves.toEqual({
        status: 'skipped',
        fieldsWritten: [],
        durationMs: 0,
        reason: 'no primary file',
      });
      expect(writer.write).not.toHaveBeenCalled();
    });

    it('writes the first of two EPUBs and skips the oversized one with its own reason', async () => {
      const bigEpub = { ...epubRow, id: 3, absolutePath: '/books/lib/book-large.epub', sizeBytes: 200 * 1024 * 1024, sortOrder: 1 };
      diskSizes.set(bigEpub.absolutePath, bigEpub.sizeBytes);
      const { service, fileWriteRepo, writer } = arrange([epubRow, bigEpub]);

      const result = await service.writeToFile(5, 'sync', 7);

      expect(writtenPaths(writer)).toEqual(['/books/lib/book.epub']);
      expect(fileWriteRepo.insertLog).toHaveBeenCalledWith(
        expect.objectContaining({ bookFileId: 3, result: expect.objectContaining({ reason: 'file exceeds size limit' }) }),
      );
      expect(result.fileCounts).toEqual({ processed: 2, succeeded: 1, failed: 0, skipped: 1 });
    });

    it('predicts the fields of every target in a mixed dry run', async () => {
      const { service, writer, coverStore } = arrange([epubRow, m4bRow], { config: { fileWriteEnabled: false } });
      writer.write.mockImplementation((path: string) =>
        Promise.resolve({
          status: 'skipped',
          fieldsWritten: path.endsWith('.epub') ? ['title', 'isbn13'] : ['title', 'narrators'],
          durationMs: 0,
          reason: 'dry-run',
        }),
      );

      const result = await service.writeToFile(5, 'sync', 7, true);

      expect(result).toMatchObject({ status: 'skipped', fieldsWritten: ['title', 'isbn13', 'narrators'], reason: 'dry-run' });
      expect(coverStore.resolve).not.toHaveBeenCalled();
    });

    it('keeps the own titles of several audio files beside an ebook', async () => {
      const bonus = { ...m4bRow, id: 3, absolutePath: '/books/lib/bonus.mp3', format: 'mp3', sortOrder: 2 };
      const { service, writer } = arrange([epubRow, m4bRow, bonus]);

      await service.writeToFile(5, 'auto');

      expect(optionsFor(writer, '/books/lib/book.m4b')).toMatchObject({ preserveTrackIdentity: true });
      expect(optionsFor(writer, '/books/lib/bonus.mp3')).toMatchObject({ preserveTrackIdentity: true });
      expect(optionsFor(writer, '/books/lib/bonus.mp3')).not.toHaveProperty('trackNumber');
    });
  });

  describe('size on disk', () => {
    const epub = { id: 1, absolutePath: '/books/lib/book.epub', format: 'epub', fileHash: 'h', libraryId: 2 };

    function arrange(sizeBytes: number | null) {
      const context = makeService();
      context.fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({ ...epub, sizeBytes });
      context.fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Book' });
      context.fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({ ...DEFAULT_LIB_CONFIG, fileWriteEpubMaxFileSizeMb: 100 });
      context.writer.write.mockResolvedValue({ status: 'success', fieldsWritten: ['title'], durationMs: 5 });
      return context;
    }

    it('enforces the limit on the size on disk, not a stale stored size', async () => {
      const { service, writer } = arrange(40);
      diskSizes.set(epub.absolutePath, 200 * 1024 * 1024);

      await expect(service.writeToFile(5, 'auto')).resolves.toMatchObject({ status: 'skipped', reason: 'file exceeds size limit' });
      expect(writer.write).not.toHaveBeenCalled();
    });

    it('enforces the limit on a file whose stored size is unknown', async () => {
      const { service, writer } = arrange(null);
      diskSizes.set(epub.absolutePath, 200 * 1024 * 1024);

      await expect(service.writeToFile(5, 'auto')).resolves.toMatchObject({ status: 'skipped', reason: 'file exceeds size limit' });
      expect(writer.write).not.toHaveBeenCalled();
    });

    it('writes a file that shrank on disk below the limit', async () => {
      const { service, writer } = arrange(200 * 1024 * 1024);
      diskSizes.set(epub.absolutePath, 1024);

      await expect(service.writeToFile(5, 'auto')).resolves.toMatchObject({ status: 'success' });
      expect(writer.write).toHaveBeenCalledTimes(1);
    });

    it('falls back to the stored size when the file cannot be read', async () => {
      const { service, writer } = arrange(200 * 1024 * 1024);
      mockStat.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      await expect(service.writeToFile(5, 'auto')).resolves.toMatchObject({ status: 'skipped', reason: 'file exceeds size limit' });
      expect(writer.write).not.toHaveBeenCalled();
    });
  });

  describe('skip logging', () => {
    it('logs a thousand skipped targets one insert at a time', async () => {
      const { service, fileWriteRepo } = makeService();
      const tracks = Array.from({ length: 1_000 }, (_, index) => ({
        id: index + 1,
        absolutePath: `/books/audio/${String(index + 1).padStart(4, '0')}.mp3`,
        format: 'mp3',
        sizeBytes: 10,
        libraryId: 2,
        role: 'content',
        sortOrder: index,
      }));
      fileWriteRepo.findPrimaryFileForBook.mockResolvedValue(tracks[0]);
      fileWriteRepo.findFilesForBook.mockResolvedValue(tracks);
      fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({ ...DEFAULT_LIB_CONFIG, fileWriteAudioEnabled: false });
      let active = 0;
      let peak = 0;
      fileWriteRepo.insertLog.mockImplementation(async () => {
        active++;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active--;
      });

      const result = await service.writeToFile(20, 'sync', 7);

      expect(result.fileCounts).toEqual({ processed: 1_000, succeeded: 0, failed: 0, skipped: 1_000 });
      expect(fileWriteRepo.insertLog).toHaveBeenCalledTimes(1_000);
      expect(peak).toBe(1);
    });

    it('keeps logging the remaining skips when one insert fails', async () => {
      const { service, fileWriteRepo, registry } = makeService();
      const tracks = [1, 2, 3].map((id) => ({
        id,
        absolutePath: `/books/audio/0${id}.opus`,
        format: 'opus',
        sizeBytes: 10,
        libraryId: 2,
        role: 'content',
      }));
      fileWriteRepo.findPrimaryFileForBook.mockResolvedValue(tracks[0]);
      fileWriteRepo.findFilesForBook.mockResolvedValue(tracks);
      registry.supports.mockReturnValue(false);
      fileWriteRepo.insertLog.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('connection reset')).mockResolvedValueOnce(undefined);

      await expect(service.writeToFile(20, 'sync', 7)).resolves.toMatchObject({ status: 'skipped', reason: 'format not supported' });
      expect(fileWriteRepo.insertLog).toHaveBeenCalledTimes(3);
    });
  });

  describe('read-along EPUBs', () => {
    const plain = {
      id: 1,
      absolutePath: '/books/lib/book.epub',
      format: 'epub',
      sizeBytes: 40,
      fileHash: 'p',
      libraryId: 2,
      role: 'content',
      sortOrder: 0,
      mediaOverlayAvailable: false,
    };
    const readAlong = { ...plain, id: 2, absolutePath: '/books/lib/book.readaloud.epub', fileHash: 'r', sortOrder: 1, mediaOverlayAvailable: true };

    function arrange(config: Record<string, unknown>) {
      const context = makeService();
      context.fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({ ...readAlong, fileWriteAllFiles: true });
      context.fileWriteRepo.findFilesForBook.mockResolvedValue([plain, readAlong]);
      context.fileWriteRepo.findLibraryFileWriteConfig.mockResolvedValue({ ...DEFAULT_LIB_CONFIG, fileWriteAllFiles: true, ...config });
      context.fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Book' });
      context.writer.write.mockResolvedValue({ status: 'success', fieldsWritten: ['title'], durationMs: 5 });
      return context;
    }

    it('leaves read-along EPUBs out by default while the plain EPUB is written', async () => {
      const { service, writer } = arrange({});

      const result = await service.writeToFile(5, 'auto');

      expect(writer.write.mock.calls.map(([path]) => path)).toEqual(['/books/lib/book.epub']);
      expect(result).toMatchObject({ status: 'success', fileCounts: { processed: 2, succeeded: 1, failed: 0, skipped: 1 } });
    });

    it('writes read-along EPUBs under their own toggle and limit, not the EPUB ones', async () => {
      const { service, writer } = arrange({ fileWriteReadAlongEnabled: true, fileWriteReadAlongMaxFileSizeMb: 1000, fileWriteEpubEnabled: false });
      diskSizes.set(readAlong.absolutePath, 400 * 1024 * 1024);

      const result = await service.writeToFile(5, 'auto');

      expect(writer.write.mock.calls.map(([path]) => path)).toEqual(['/books/lib/book.readaloud.epub']);
      expect(result.fileCounts).toEqual({ processed: 2, succeeded: 1, failed: 0, skipped: 1 });
    });

    it('applies the read-along size limit', async () => {
      const { service, fileWriteRepo, writer } = arrange({ fileWriteReadAlongEnabled: true, fileWriteReadAlongMaxFileSizeMb: 100 });
      diskSizes.set(readAlong.absolutePath, 400 * 1024 * 1024);

      await service.writeToFile(5, 'sync', 7);

      expect(writer.write.mock.calls.map(([path]) => path)).toEqual(['/books/lib/book.epub']);
      expect(fileWriteRepo.insertLog).toHaveBeenCalledWith(
        expect.objectContaining({ bookFileId: 2, result: expect.objectContaining({ reason: 'file exceeds size limit' }) }),
      );
    });

    it('reports a read-along EPUB as format disabled while its toggle is off', () => {
      const { service } = makeService();

      expect(service.resolveBookFileWriteStatus({ ...DEFAULT_LIB_CONFIG, fileWriteAllFiles: true }, [plain, readAlong], 2).targets).toEqual([
        { fileId: 1, format: 'epub', writable: true, reason: null, writableFields: [...EPUB_BOOK_FILE_WRITE_FIELDS] },
        { fileId: 2, format: 'epub', writable: false, reason: 'format_disabled', writableFields: [] },
      ]);
    });
  });

  describe('per-file capability', () => {
    const ALL_FILES_CONFIG = { ...DEFAULT_LIB_CONFIG, fileWriteAllFiles: true };

    it('lists the ebook primary as the only target while the flag is off', () => {
      const { service } = makeService();

      expect(
        service.resolveBookFileWriteStatus(
          DEFAULT_LIB_CONFIG,
          [
            { id: 1, format: 'epub', sizeBytes: 1024, role: 'content' },
            { id: 2, format: 'm4b', sizeBytes: 1024, role: 'content' },
          ],
          1,
        ).targets,
      ).toEqual([{ fileId: 1, format: 'epub', writable: true, reason: null, writableFields: [...EPUB_BOOK_FILE_WRITE_FIELDS] }]);
    });

    it('reports every writable format of a mixed book, each file with its own fields', () => {
      const { service } = makeService();

      expect(
        service.resolveBookFileWriteStatus(
          ALL_FILES_CONFIG,
          [
            { id: 1, format: 'epub', sizeBytes: 1024, role: 'content', sortOrder: 0 },
            { id: 2, format: 'm4b', sizeBytes: 1024, role: 'content', sortOrder: 1 },
          ],
          1,
        ),
      ).toEqual({
        enabled: true,
        reason: null,
        writableFormats: ['epub', 'm4b'],
        writableFields: [...new Set([...EPUB_BOOK_FILE_WRITE_FIELDS, ...AUDIO_BOOK_FILE_WRITE_FIELDS])],
        targets: [
          { fileId: 1, format: 'epub', writable: true, reason: null, writableFields: [...EPUB_BOOK_FILE_WRITE_FIELDS] },
          { fileId: 2, format: 'm4b', writable: true, reason: null, writableFields: [...AUDIO_BOOK_FILE_WRITE_FIELDS] },
        ],
      });
    });

    it('tells a writable EPUB from an oversized EPUB in the same book', () => {
      const { service } = makeService();

      const status = service.resolveBookFileWriteStatus(
        { ...ALL_FILES_CONFIG, fileWriteEpubMaxFileSizeMb: 1 },
        [
          { id: 1, format: 'epub', sizeBytes: 1024, role: 'content', sortOrder: 0 },
          { id: 2, format: 'epub', sizeBytes: 2 * 1024 * 1024, role: 'content', sortOrder: 1 },
        ],
        1,
      );

      expect(status.writableFormats).toEqual(['epub']);
      expect(status.targets?.map(({ fileId, writable, reason }) => ({ fileId, writable, reason }))).toEqual([
        { fileId: 1, writable: true, reason: null },
        { fileId: 2, writable: false, reason: 'file_exceeds_size_limit' },
      ]);
    });

    it('reports a supplement per file but keeps it out of the book-level reason', () => {
      const { service, registry } = makeService();
      registry.supports.mockImplementation((format: string) => format === 'pdf');

      const status = service.resolveBookFileWriteStatus(
        ALL_FILES_CONFIG,
        [
          { id: 1, format: 'opus', sizeBytes: 1024, role: 'content' },
          { id: 2, format: 'pdf', sizeBytes: 1024, role: 'supplement' },
        ],
        1,
      );

      expect(status).toMatchObject({ enabled: false, reason: 'format_not_supported' });
      expect(status.targets?.find((target) => target.fileId === 2)).toEqual({
        fileId: 2,
        format: 'pdf',
        writable: false,
        reason: 'not_content_file',
        writableFields: [],
      });
    });

    it('reports content files of a book without a primary as writable', () => {
      const { service } = makeService();

      expect(service.resolveBookFileWriteStatus(ALL_FILES_CONFIG, [{ id: 2, format: 'epub', sizeBytes: 1024, role: 'content' }], null)).toMatchObject(
        {
          enabled: true,
          writableFormats: ['epub'],
        },
      );
    });

    it('treats a library config without the scope flag as incomplete', () => {
      const { service } = makeService();
      const withoutFlag: Partial<typeof DEFAULT_LIB_CONFIG> = { ...DEFAULT_LIB_CONFIG };
      delete withoutFlag.fileWriteAllFiles;

      expect(service.resolveBookFileWriteStatus(withoutFlag, [{ id: 1, format: 'epub', sizeBytes: 1024 }], 1)).toMatchObject({
        enabled: false,
        reason: 'library_disabled',
      });
    });
  });

  // Characterisation of the selection rule as it stood before multi-file write-back. With the
  // library flag off, every one of these must keep passing unchanged.
  describe('characterisation: primary-only target selection', () => {
    const epubPrimary = {
      id: 1,
      absolutePath: '/books/lib/book.epub',
      format: 'epub',
      sizeBytes: 40,
      fileHash: 'epubhash',
      libraryId: 2,
      role: 'content',
    };
    const m4bPrimary = {
      id: 1,
      absolutePath: '/books/audio/book.m4b',
      format: 'm4b',
      sizeBytes: 100,
      fileHash: 'm4bhash',
      libraryId: 2,
      role: 'content',
    };

    it('writes only the ebook primary and never lists the other files', async () => {
      const { service, fileWriteRepo, writer } = makeService();
      fileWriteRepo.findPrimaryFileForBook.mockResolvedValue(epubPrimary);
      fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Book' });
      writer.write.mockResolvedValue({ status: 'success', fieldsWritten: ['title'], durationMs: 5 });

      await service.writeToFile(5, 'auto');

      expect(fileWriteRepo.findFilesForBook).not.toHaveBeenCalled();
      expect(writer.write).toHaveBeenCalledTimes(1);
      expect(writer.write).toHaveBeenCalledWith('/books/lib/book.epub', expect.anything(), expect.anything());
    });

    it('writes every audio track of an audio primary and leaves its ebook sibling alone', async () => {
      const { service, fileWriteRepo, writer } = makeService();
      fileWriteRepo.findPrimaryFileForBook.mockResolvedValue(m4bPrimary);
      fileWriteRepo.findFilesForBook.mockResolvedValue([
        { ...m4bPrimary, role: 'content' },
        { id: 2, absolutePath: '/books/audio/book.epub', format: 'epub', sizeBytes: 40, fileHash: 'e', libraryId: 2, role: 'content' },
        { id: 3, absolutePath: '/books/audio/part-2.mp3', format: 'mp3', sizeBytes: 40, fileHash: 'm', libraryId: 2, role: 'content' },
      ]);
      fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Book' });
      writer.write.mockResolvedValue({ status: 'success', fieldsWritten: ['title'], durationMs: 5 });

      await service.writeToFile(5, 'auto');

      expect(writer.write.mock.calls.map(([path]) => path)).toEqual(['/books/audio/book.m4b', '/books/audio/part-2.mp3']);
    });

    it('falls back to the audio primary when the book lists no audio files', async () => {
      const { service, fileWriteRepo, writer } = makeService();
      fileWriteRepo.findPrimaryFileForBook.mockResolvedValue(m4bPrimary);
      fileWriteRepo.findFilesForBook.mockResolvedValue([]);
      fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Book' });
      writer.write.mockResolvedValue({ status: 'success', fieldsWritten: ['title'], durationMs: 5 });

      await expect(service.writeToFile(5, 'auto')).resolves.toEqual({ status: 'success', fieldsWritten: ['title'], durationMs: 5 });

      expect(writer.write).toHaveBeenCalledTimes(1);
      expect(writer.write).toHaveBeenCalledWith(
        '/books/audio/book.m4b',
        expect.anything(),
        expect.objectContaining({ isMultiTrackAudio: false, trackNumber: 1, trackTotal: 1 }),
      );
    });

    it('keeps the predicted fields of a single-target dry run', async () => {
      const { service, fileWriteRepo, writer } = makeService();
      fileWriteRepo.findPrimaryFileForBook.mockResolvedValue(epubPrimary);
      fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Book' });
      writer.write.mockResolvedValue({ status: 'skipped', fieldsWritten: ['title', 'authors'], durationMs: 0, reason: 'dry-run' });

      await expect(service.writeToFile(5, 'sync', 1, true)).resolves.toEqual({
        status: 'skipped',
        fieldsWritten: ['title', 'authors'],
        durationMs: 0,
        reason: 'dry-run',
      });
    });

    // Recorded as dropping the fields before multi-file write-back; aggregation now keeps them, so a
    // preview no longer reports that nothing will change the moment a book has a second target.
    it('keeps the predicted fields of a two-target dry run', async () => {
      const { service, fileWriteRepo, writer } = makeService();
      fileWriteRepo.findPrimaryFileForBook.mockResolvedValue(m4bPrimary);
      fileWriteRepo.findFilesForBook.mockResolvedValue([
        { ...m4bPrimary, role: 'content' },
        { id: 2, absolutePath: '/books/audio/part-2.mp3', format: 'mp3', sizeBytes: 40, fileHash: 'm', libraryId: 2, role: 'content' },
      ]);
      fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Book' });
      writer.write.mockResolvedValue({ status: 'skipped', fieldsWritten: ['title'], durationMs: 0, reason: 'dry-run' });

      const result = await service.writeToFile(5, 'sync', 1, true);

      expect(result.status).toBe('skipped');
      expect(result.fieldsWritten).toEqual(['title']);
      expect(result.fileCounts).toEqual({ processed: 2, succeeded: 0, failed: 0, skipped: 2 });
    });

    it('resolves the audiobook cover once for a whole audio track set', async () => {
      const { service, fileWriteRepo, writer, coverStore } = makeService();
      fileWriteRepo.findPrimaryFileForBook.mockResolvedValue(m4bPrimary);
      fileWriteRepo.findFilesForBook.mockResolvedValue([
        { ...m4bPrimary, role: 'content' },
        { id: 2, absolutePath: '/books/audio/part-2.mp3', format: 'mp3', sizeBytes: 40, fileHash: 'm', libraryId: 2, role: 'content' },
      ]);
      fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Book' });
      coverStore.resolve.mockResolvedValue('/covers/audio.jpg');
      mockReadFile.mockResolvedValue(Buffer.from('square') as never);
      writer.write.mockResolvedValue({ status: 'success', fieldsWritten: ['coverBytes'], durationMs: 5 });

      await service.writeToFile(5, 'auto');

      expect(coverStore.resolve).toHaveBeenCalledTimes(1);
      expect(coverStore.resolve).toHaveBeenCalledWith(5, { medium: 'audio', variant: 'cover', strict: true });
      expect(mockReadFile).toHaveBeenCalledTimes(1);
    });

    describe('capability', () => {
      it('falls back to the audio primary when the book lists no other audio files', () => {
        const { service } = makeService();

        expect(service.resolveBookFileWriteStatus(DEFAULT_LIB_CONFIG, [{ id: 1, format: 'm4b', sizeBytes: 1024, role: 'content' }], 1)).toMatchObject(
          {
            enabled: true,
            reason: null,
            writableFormats: ['m4b'],
            writableFields: [...AUDIO_BOOK_FILE_WRITE_FIELDS],
          },
        );
      });

      it('reports only the ebook primary for an ebook with an audiobook sibling', () => {
        const { service } = makeService();

        expect(
          service.resolveBookFileWriteStatus(
            DEFAULT_LIB_CONFIG,
            [
              { id: 1, format: 'epub', sizeBytes: 1024, role: 'content' },
              { id: 2, format: 'm4b', sizeBytes: 1024, role: 'content' },
            ],
            1,
          ),
        ).toMatchObject({ enabled: true, reason: null, writableFormats: ['epub'], writableFields: [...EPUB_BOOK_FILE_WRITE_FIELDS] });
      });

      it('reports an unsupported primary as not supported', () => {
        const { service, registry } = makeService();
        registry.supports.mockReturnValue(false);

        expect(
          service.resolveBookFileWriteStatus(DEFAULT_LIB_CONFIG, [{ id: 1, format: 'opus', sizeBytes: 1024, role: 'content' }], 1),
        ).toMatchObject({
          enabled: false,
          reason: 'format_not_supported',
          writableFormats: [],
          writableFields: [],
        });
      });

      it('reports a disabled audio family as format disabled', () => {
        const { service } = makeService();

        expect(
          service.resolveBookFileWriteStatus(
            { ...DEFAULT_LIB_CONFIG, fileWriteAudioEnabled: false },
            [{ id: 1, format: 'mp3', sizeBytes: 1024, role: 'content' }],
            1,
          ),
        ).toMatchObject({ enabled: false, reason: 'format_disabled', writableFormats: [], writableFields: [] });
      });

      it('reports no primary file when the primary is missing', () => {
        const { service } = makeService();

        expect(service.resolveBookFileWriteStatus(DEFAULT_LIB_CONFIG, [{ id: 2, format: 'epub', sizeBytes: 1024, role: 'content' }], null)).toEqual({
          enabled: false,
          reason: 'no_primary_file',
          writableFormats: [],
          writableFields: [],
        });
      });
    });
  });
});
