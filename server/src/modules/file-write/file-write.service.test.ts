import { ConfigService } from '@nestjs/config';
import type { MockedFunction } from 'vitest';
import { readdir, readFile } from 'fs/promises';

import { FileWriteService } from './file-write.service';

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual('fs/promises');
  return {
    ...actual,
    readdir: vi.fn(),
    readFile: vi.fn(),
  };
});

const mockReaddir = readdir as MockedFunction<typeof readdir>;
const mockReadFile = readFile as MockedFunction<typeof readFile>;

const DEFAULT_LIB_CONFIG = {
  fileWriteEnabled: true,
  fileWriteWriteCover: true,
  fileWriteEpubEnabled: true,
  fileWriteEpubMaxFileSizeMb: 100,
  fileWritePdfEnabled: true,
  fileWritePdfMaxFileSizeMb: 100,
  fileWriteCbxEnabled: true,
  fileWriteCbxMaxFileSizeMb: 500,
};

describe('FileWriteService', () => {
  function makeService(configValues: Record<string, unknown> = {}) {
    const fileWriteRepo = {
      findPrimaryFileForBook: vi.fn(),
      findLibraryFileWriteConfig: vi.fn().mockResolvedValue({ ...DEFAULT_LIB_CONFIG }),
      loadPayload: vi.fn(),
      insertLog: vi.fn().mockResolvedValue(undefined),
      setLastWrittenAt: vi.fn().mockResolvedValue(undefined),
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
      get: vi.fn().mockImplementation((key: string) => (key === 'storage.booksPath' ? '/books' : configValues[key])),
    } as unknown as ConfigService;

    const service = new FileWriteService(fileWriteRepo as never, registry as never, lockService as never, config);

    return { service, fileWriteRepo, registry, writer, lockService };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockReaddir.mockReset();
    mockReadFile.mockReset();
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
    expect(lockService.withLock).toHaveBeenCalledTimes(1);
    expect(writer.write).toHaveBeenCalledWith(
      '/books/lib/book.epub',
      expect.objectContaining({ title: 'Dune', coverBytes }),
      expect.objectContaining({ dryRun: false }),
    );
    expect(mockReadFile).toHaveBeenCalledWith('/books/covers/5/cover_custom.png');
    expect(fileWriteRepo.insertLog).toHaveBeenCalledTimes(1);
    expect(fileWriteRepo.setLastWrittenAt).toHaveBeenCalledWith(5, expect.any(Date));
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
    });

    const result = await service.writeToFile(10, 'auto');

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('file exceeds size limit');
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
});
