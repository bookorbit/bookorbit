import { ConfigService } from '@nestjs/config';
import type { MockedFunction } from 'vitest';
import { readdir, readFile } from 'fs/promises';

import { DEFAULT_FILE_WRITE_SETTINGS } from '@projectx/types';
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

describe('FileWriteService', () => {
  function makeService() {
    const fileWriteRepo = {
      findPrimaryFileForBook: vi.fn(),
      loadPayload: vi.fn(),
      insertLog: vi.fn().mockResolvedValue(undefined),
      setLastWrittenAt: vi.fn().mockResolvedValue(undefined),
    };
    const settingsService = {
      resolve: vi.fn().mockResolvedValue({ ...DEFAULT_FILE_WRITE_SETTINGS, enabled: true }),
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
      get: vi.fn().mockImplementation((key: string) => (key === 'storage.booksPath' ? '/books' : undefined)),
    } as unknown as ConfigService;

    const service = new FileWriteService(fileWriteRepo as never, settingsService as never, registry as never, lockService as never, config);

    return { service, fileWriteRepo, settingsService, registry, writer, lockService };
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

  it('returns disabled when global writes are off (non-dry-run)', async () => {
    const { service, fileWriteRepo, settingsService, writer } = makeService();
    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/x.epub',
      format: 'epub',
      sizeBytes: 10,
      libraryId: 2,
    });
    settingsService.resolve.mockResolvedValue({ ...DEFAULT_FILE_WRITE_SETTINGS, enabled: false });

    const result = await service.writeToFile(10, 'auto');

    expect(result).toEqual({ status: 'skipped', fieldsWritten: [], durationMs: 0, reason: 'disabled' });
    expect(writer.write).not.toHaveBeenCalled();
  });

  it('skips when format exceeds max size and logs for sync trigger', async () => {
    const { service, fileWriteRepo, settingsService } = makeService();
    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/x.pdf',
      format: 'pdf',
      sizeBytes: 500,
      libraryId: 2,
    });
    settingsService.resolve.mockResolvedValue({
      ...DEFAULT_FILE_WRITE_SETTINGS,
      enabled: true,
      pdf: { enabled: true, maxFileSizeBytes: 100 },
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
    const { service, fileWriteRepo, settingsService, writer, lockService } = makeService();

    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/lib/book.epub',
      format: 'epub',
      sizeBytes: 40,
      libraryId: 2,
    });
    fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Dune', authors: [{ name: 'Frank Herbert', sortName: null }] });
    settingsService.resolve.mockResolvedValue({ ...DEFAULT_FILE_WRITE_SETTINGS, enabled: true, writeCover: true });

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

  it('returns failed and logs when writer throws', async () => {
    const { service, fileWriteRepo, settingsService, writer } = makeService();

    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/lib/book.cbz',
      format: 'cbz',
      sizeBytes: 40,
      libraryId: 2,
    });
    fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Dune' });
    settingsService.resolve.mockResolvedValue({
      ...DEFAULT_FILE_WRITE_SETTINGS,
      enabled: true,
      cbx: { enabled: true, formats: ['cbz', 'cb7'], maxFileSizeBytes: 1_000_000 },
    });
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

  it('dry-run bypasses global disabled gate and avoids cover read', async () => {
    const { service, fileWriteRepo, settingsService, writer } = makeService();

    fileWriteRepo.findPrimaryFileForBook.mockResolvedValue({
      id: 1,
      absolutePath: '/books/lib/book.epub',
      format: 'epub',
      sizeBytes: 40,
      libraryId: 2,
    });
    fileWriteRepo.loadPayload.mockResolvedValue({ title: 'Dune' });
    settingsService.resolve.mockResolvedValue({ ...DEFAULT_FILE_WRITE_SETTINGS, enabled: false, writeCover: true });
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
});
