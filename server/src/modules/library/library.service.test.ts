vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  rm: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('../scanner/lib/classify', () => ({
  isPrimaryFormat: vi.fn(),
}));

import { BadRequestException, ConflictException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { readdir, rm, stat } from 'fs/promises';

import { isPrimaryFormat } from '../scanner/lib/classify';
import { LibraryService } from './library.service';

const mockReaddir = readdir as MockedFunction<typeof readdir>;
const mockRm = rm as MockedFunction<typeof rm>;
const mockStat = stat as MockedFunction<typeof stat>;
const mockIsPrimaryFormat = isPrimaryFormat as MockedFunction<typeof isPrimaryFormat>;

function dirent(name: string, kind: 'file' | 'dir') {
  return {
    name,
    isDirectory: () => kind === 'dir',
    isFile: () => kind === 'file',
  };
}

describe('LibraryService', () => {
  const libraryRepo = {
    hasUserAccess: vi.fn(),
    findAll: vi.fn(),
    findAllForUser: vi.fn(),
    findAllFolders: vi.fn(),
    findFoldersByLibraryIds: vi.fn(),
    findById: vi.fn(),
    findFoldersByLibrary: vi.fn(),
    findByName: vi.fn(),
    insert: vi.fn(),
    insertFolder: vi.fn(),
    update: vi.fn(),
    deleteFolder: vi.fn(),
    findBookIdsByLibrary: vi.fn(),
    delete: vi.fn(),
    findAllFolderPaths: vi.fn(),
    getStats: vi.fn(),
    updateDisplayOrders: vi.fn(),
    getAccessWithUsers: vi.fn(),
    grantAccess: vi.fn(),
    updateAccess: vi.fn(),
    revokeAccess: vi.fn(),
  };

  const config = { get: vi.fn().mockReturnValue('/books') };
  const scannerService = { startScanAsync: vi.fn() };
  const fileWatcherService = { startWatcher: vi.fn(), stopWatcher: vi.fn() };
  const fileWriteService = {
    resolveSettings: vi.fn(),
    findNonMissingBookFilesByLibrary: vi.fn(),
    writeToFile: vi.fn(),
  };

  let service: LibraryService;

  beforeEach(() => {
    vi.resetAllMocks();
    config.get.mockReturnValue('/books');
    service = new LibraryService(libraryRepo as any, config as any, scannerService as any, fileWatcherService as any, fileWriteService as any);

    mockStat.mockResolvedValue({ isDirectory: () => true } as Awaited<ReturnType<typeof stat>>);
    mockReaddir.mockResolvedValue([] as unknown as Awaited<ReturnType<typeof readdir>>);
    mockRm.mockResolvedValue(undefined);
    mockIsPrimaryFormat.mockReturnValue(false);
  });

  it('findAll uses scoped folder query for non-superusers', async () => {
    libraryRepo.findAllForUser.mockResolvedValue([{ id: 10, name: 'A' }]);
    libraryRepo.findFoldersByLibraryIds.mockResolvedValue([{ id: 1, libraryId: 10, path: '/a', createdAt: new Date() }]);

    const result = await service.findAll({ id: 7, isSuperuser: false } as any);

    expect(libraryRepo.findAllForUser).toHaveBeenCalledWith(7);
    expect(libraryRepo.findFoldersByLibraryIds).toHaveBeenCalledWith([10]);
    expect(libraryRepo.findAllFolders).not.toHaveBeenCalled();
    expect(result[0].folders).toEqual([{ id: 1, path: '/a', createdAt: expect.any(Date) }]);
  });

  it('verifyUserAccess bypasses lookup for superusers', async () => {
    await service.verifyUserAccess(1, 2, true);
    expect(libraryRepo.hasUserAccess).not.toHaveBeenCalled();
  });

  it('verifyUserAccess throws when user has no library access', async () => {
    libraryRepo.hasUserAccess.mockResolvedValue(false);
    await expect(service.verifyUserAccess(1, 2, false)).rejects.toThrow('No access to this library');
  });

  it('create applies defaults, inserts folders, and starts an async scan', async () => {
    libraryRepo.findByName.mockResolvedValue([]);
    libraryRepo.insert.mockResolvedValue([{ id: 5, name: 'Sci-Fi' }]);
    libraryRepo.insertFolder.mockResolvedValueOnce([{ id: 11, path: '/a' }]).mockResolvedValueOnce([{ id: 12, path: '/b' }]);

    const result = await service.create({ name: 'Sci-Fi', folders: ['/a', '/b'] } as any);

    expect(libraryRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Sci-Fi',
        displayOrder: 0,
        watch: false,
        metadataPrecedence: ['folderStructure', 'embedded', 'nfoFile', 'opfFile', 'sidecar'],
        formatPriority: ['epub', 'pdf', 'cbz', 'cbr', 'cb7', 'mobi', 'azw3', 'azw', 'fb2', 'm4b', 'mp3', 'm4a', 'opus', 'ogg', 'flac'],
        organizationMode: 'book_per_folder',
        coverAspectRatio: '2/3',
      }),
    );
    expect(scannerService.startScanAsync).toHaveBeenCalledWith(5);
    expect(fileWatcherService.startWatcher).not.toHaveBeenCalled();
    expect(result.folders).toEqual([
      { id: 11, path: '/a' },
      { id: 12, path: '/b' },
    ]);
  });

  it('create starts watcher immediately when watch is enabled', async () => {
    libraryRepo.findByName.mockResolvedValue([]);
    libraryRepo.insert.mockResolvedValue([{ id: 6, name: 'Watched', watch: true }]);
    libraryRepo.insertFolder.mockResolvedValueOnce([{ id: 21, path: '/watch-a' }]).mockResolvedValueOnce([{ id: 22, path: '/watch-b' }]);

    await service.create({ name: 'Watched', folders: ['/watch-a', '/watch-b'], watch: true } as any);

    expect(fileWatcherService.startWatcher).toHaveBeenCalledWith(6, ['/watch-a', '/watch-b']);
    expect(scannerService.startScanAsync).toHaveBeenCalledWith(6);
  });

  it('create rejects duplicate library names', async () => {
    libraryRepo.findByName.mockResolvedValue([{ id: 9 }]);

    await expect(service.create({ name: 'Dup', folders: ['/x'] } as any)).rejects.toBeInstanceOf(ConflictException);
  });

  it('update synchronizes folder additions and removals', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 3, name: 'Current', watch: false }]);
    libraryRepo.update.mockResolvedValue([{ id: 3, name: 'Updated' }]);
    libraryRepo.findFoldersByLibrary
      .mockResolvedValueOnce([
        { id: 1, path: '/keep' },
        { id: 2, path: '/remove' },
      ])
      .mockResolvedValueOnce([
        { id: 1, path: '/keep' },
        { id: 3, path: '/add' },
      ]);

    await service.update(3, { folders: ['/keep', '/add'] } as any);

    expect(libraryRepo.deleteFolder).toHaveBeenCalledWith(2);
    expect(libraryRepo.insertFolder).toHaveBeenCalledWith({ libraryId: 3, path: '/add' });
    expect(fileWatcherService.startWatcher).not.toHaveBeenCalled();
    expect(fileWatcherService.stopWatcher).not.toHaveBeenCalled();
  });

  it('update starts watcher when watch toggles on', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 7, name: 'Current', watch: false }]);
    libraryRepo.update.mockResolvedValue([{ id: 7, name: 'Current', watch: true }]);
    libraryRepo.findFoldersByLibrary.mockResolvedValue([{ id: 31, path: '/watched' }]);

    await service.update(7, { watch: true } as any);

    expect(fileWatcherService.startWatcher).toHaveBeenCalledWith(7, ['/watched']);
    expect(fileWatcherService.stopWatcher).not.toHaveBeenCalled();
  });

  it('update stops watcher when watch toggles off', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 8, name: 'Current', watch: true }]);
    libraryRepo.update.mockResolvedValue([{ id: 8, name: 'Current', watch: false }]);
    libraryRepo.findFoldersByLibrary.mockResolvedValue([{ id: 41, path: '/watched' }]);

    await service.update(8, { watch: false } as any);

    expect(fileWatcherService.stopWatcher).toHaveBeenCalledWith(8);
    expect(fileWatcherService.startWatcher).not.toHaveBeenCalled();
  });

  it('update rebinds watcher when folders change and watch remains on', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 9, name: 'Current', watch: true }]);
    libraryRepo.update.mockResolvedValue([{ id: 9, name: 'Current', watch: true }]);
    libraryRepo.findFoldersByLibrary
      .mockResolvedValueOnce([
        { id: 1, path: '/keep' },
        { id: 2, path: '/remove' },
      ])
      .mockResolvedValueOnce([
        { id: 1, path: '/keep' },
        { id: 3, path: '/add' },
      ]);

    await service.update(9, { folders: ['/keep', '/add'] } as any);

    expect(fileWatcherService.startWatcher).toHaveBeenCalledWith(9, ['/keep', '/add']);
  });

  it('update triggers a background scan when format selection settings change', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 10, name: 'Current', watch: false }]);
    libraryRepo.update.mockResolvedValue([{ id: 10, name: 'Current', watch: false }]);
    libraryRepo.findFoldersByLibrary.mockResolvedValue([{ id: 1, path: '/books' }]);

    await service.update(10, { formatPriority: ['epub', 'pdf'], allowedFormats: ['epub'] } as any);

    expect(scannerService.startScanAsync).toHaveBeenCalledWith(10);
  });

  it('remove deletes library and cleans related cover directories', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 4, name: 'L' }]);
    libraryRepo.findBookIdsByLibrary.mockResolvedValue([{ id: 101 }, { id: 102 }]);

    await service.remove(4);

    expect(fileWatcherService.stopWatcher).toHaveBeenCalledWith(4);
    expect(libraryRepo.delete).toHaveBeenCalledWith(4);
    expect(mockRm).toHaveBeenCalledWith('/books/covers/101', { recursive: true, force: true });
    expect(mockRm).toHaveBeenCalledWith('/books/covers/102', { recursive: true, force: true });
  });

  it('remove throws when library does not exist', async () => {
    libraryRepo.findById.mockResolvedValue([]);

    await expect(service.remove(99)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('prescan counts primary files recursively and flags overlapping paths', async () => {
    libraryRepo.findAllFolderPaths.mockResolvedValue([{ path: '/books/existing', libraryName: 'Existing Library' }]);

    mockReaddir.mockImplementation((path: Parameters<typeof readdir>[0]) => {
      if (path === '/books/new') {
        return Promise.resolve([dirent('a.epub', 'file'), dirent('.hidden.epub', 'file'), dirent('sub', 'dir')] as any);
      }
      if (path === '/books/new/sub') {
        return Promise.resolve([dirent('b.pdf', 'file'), dirent('note.txt', 'file')] as any);
      }
      return Promise.resolve([] as any);
    });

    mockIsPrimaryFormat.mockImplementation((path: string) => path.endsWith('.epub') || path.endsWith('.pdf'));

    const result = await service.prescan({ paths: ['/books/new', '/books/existing/sub'] } as any);

    expect(result.totalFiles).toBe(2);
    expect(result.paths[0]).toEqual(expect.objectContaining({ path: '/books/new', accessible: true, fileCount: 2 }));
    expect(result.paths[1]).toEqual(expect.objectContaining({ overlapLibrary: 'Existing Library' }));
  });

  it('prescan reports non-directory paths with explicit error', async () => {
    libraryRepo.findAllFolderPaths.mockResolvedValue([]);
    mockStat.mockResolvedValue({ isDirectory: () => false } as Awaited<ReturnType<typeof stat>>);

    const result = await service.prescan({ paths: ['/tmp/file'] } as any);

    expect(result.paths[0]).toEqual({ path: '/tmp/file', accessible: false, fileCount: 0, error: 'Not a directory' });
  });

  it('prescan reports ENOENT paths with a sanitized message', async () => {
    libraryRepo.findAllFolderPaths.mockResolvedValue([]);
    mockStat.mockRejectedValue({ code: 'ENOENT' });

    const result = await service.prescan({ paths: ['/tmp/missing'] } as any);

    expect(result.paths[0]).toEqual(expect.objectContaining({ accessible: false, error: 'Path does not exist' }));
  });

  it('getStats maps repository overflow errors to InternalServerErrorException', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 1, name: 'L' }]);
    libraryRepo.getStats.mockRejectedValue(new RangeError('overflow'));

    await expect(service.getStats(1)).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('writeMetadataToFiles blocks non-dry-run when file write is disabled', async () => {
    fileWriteService.resolveSettings.mockResolvedValue({ enabled: false });

    await expect(service.writeMetadataToFiles(1, 7, false)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('writeMetadataToFiles emits progress and returns summary counters', async () => {
    fileWriteService.resolveSettings.mockResolvedValue({ enabled: true });
    fileWriteService.findNonMissingBookFilesByLibrary.mockResolvedValue([{ bookId: 1 }, { bookId: 2 }, { bookId: 3 }]);
    fileWriteService.writeToFile
      .mockResolvedValueOnce({ status: 'success', fieldsWritten: [], durationMs: 1 })
      .mockResolvedValueOnce({ status: 'failed', fieldsWritten: [], durationMs: 1, reason: 'write failed' })
      .mockResolvedValueOnce({ status: 'skipped', fieldsWritten: [], durationMs: 1, reason: 'no changes' });

    const onProgress = vi.fn();
    const summary = await service.writeMetadataToFiles(1, 7, false, { onProgress });

    expect(summary).toEqual({ processed: 3, succeeded: 1, failed: 1, skipped: 1, cancelled: false });
    expect(onProgress).toHaveBeenNthCalledWith(1, { bookId: 1, status: 'success', reason: undefined });
    expect(onProgress).toHaveBeenNthCalledWith(2, { bookId: 2, status: 'failed', reason: 'write failed' });
    expect(onProgress).toHaveBeenNthCalledWith(3, { bookId: 3, status: 'skipped', reason: 'no changes' });
  });

  it('writeMetadataToFiles stops when cancellation is requested', async () => {
    fileWriteService.resolveSettings.mockResolvedValue({ enabled: true });
    fileWriteService.findNonMissingBookFilesByLibrary.mockResolvedValue([{ bookId: 1 }, { bookId: 2 }]);
    fileWriteService.writeToFile.mockResolvedValue({ status: 'success', fieldsWritten: [], durationMs: 1 });

    let isCancelled = false;
    const summary = await service.writeMetadataToFiles(1, 7, false, {
      onProgress: () => {
        isCancelled = true;
      },
      isCancelled: () => isCancelled,
    });

    expect(fileWriteService.writeToFile).toHaveBeenCalledTimes(1);
    expect(summary).toEqual({ processed: 1, succeeded: 1, failed: 0, skipped: 0, cancelled: true });
  });
});
