vi.mock('fs/promises', () => ({
  access: vi.fn(),
  readdir: vi.fn(),
  rm: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('../scanner/lib/classify', () => ({
  isPrimaryFormat: vi.fn(),
}));

import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { access, readdir, rm, stat } from 'fs/promises';

import { isPrimaryFormat } from '../scanner/lib/classify';
import { LibraryService } from './library.service';

const mockAccess = access as MockedFunction<typeof access>;
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

  let service: LibraryService;

  beforeEach(() => {
    vi.resetAllMocks();
    config.get.mockReturnValue('/books');
    service = new LibraryService(libraryRepo as any, config as any, scannerService as any, fileWatcherService as any);

    mockAccess.mockResolvedValue(undefined);
    mockStat.mockResolvedValue({ isDirectory: () => true } as Awaited<ReturnType<typeof stat>>);
    mockReaddir.mockResolvedValue([] as unknown as Awaited<ReturnType<typeof readdir>>);
    mockRm.mockResolvedValue(undefined);
    mockIsPrimaryFormat.mockReturnValue(false);
  });

  it('verifyUserAccess bypasses lookup for superusers', async () => {
    await service.verifyUserAccess(1, 2, true);
    expect(libraryRepo.hasUserAccess).not.toHaveBeenCalled();
  });

  it('verifyUserAccess throws ForbiddenException when user has no access', async () => {
    libraryRepo.hasUserAccess.mockResolvedValue(false);

    await expect(service.verifyUserAccess(1, 2, false)).rejects.toBeInstanceOf(ForbiddenException);
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
        formatPriority: ['epub', 'pdf', 'cbz', 'cbr', 'mobi', 'azw3', 'fb2'],
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
});
