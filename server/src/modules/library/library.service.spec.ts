jest.mock('fs/promises', () => ({
  access: jest.fn(),
  readdir: jest.fn(),
  rm: jest.fn(),
  stat: jest.fn(),
}));

jest.mock('../scanner/lib/classify', () => ({
  isPrimaryFormat: jest.fn(),
}));

import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { access, readdir, rm, stat } from 'fs/promises';

import { isPrimaryFormat } from '../scanner/lib/classify';
import { LibraryService } from './library.service';

const mockAccess = access as jest.MockedFunction<typeof access>;
const mockReaddir = readdir as jest.MockedFunction<typeof readdir>;
const mockRm = rm as jest.MockedFunction<typeof rm>;
const mockStat = stat as jest.MockedFunction<typeof stat>;
const mockIsPrimaryFormat = isPrimaryFormat as jest.MockedFunction<typeof isPrimaryFormat>;

function dirent(name: string, kind: 'file' | 'dir') {
  return {
    name,
    isDirectory: () => kind === 'dir',
    isFile: () => kind === 'file',
  };
}

describe('LibraryService', () => {
  const libraryRepo = {
    hasUserAccess: jest.fn(),
    findAll: jest.fn(),
    findAllForUser: jest.fn(),
    findAllFolders: jest.fn(),
    findById: jest.fn(),
    findFoldersByLibrary: jest.fn(),
    findByName: jest.fn(),
    insert: jest.fn(),
    insertFolder: jest.fn(),
    update: jest.fn(),
    deleteFolder: jest.fn(),
    findBookIdsByLibrary: jest.fn(),
    delete: jest.fn(),
    findAllFolderPaths: jest.fn(),
    getStats: jest.fn(),
    updateDisplayOrders: jest.fn(),
    getAccessWithUsers: jest.fn(),
    grantAccess: jest.fn(),
    updateAccess: jest.fn(),
    revokeAccess: jest.fn(),
  };

  const config = { get: jest.fn().mockReturnValue('/books') };
  const scannerService = { startScanAsync: jest.fn() };

  let service: LibraryService;

  beforeEach(() => {
    jest.resetAllMocks();
    config.get.mockReturnValue('/books');
    service = new LibraryService(libraryRepo as any, config as any, scannerService as any);

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
    expect(result.folders).toEqual([{ id: 11, path: '/a' }, { id: 12, path: '/b' }]);
  });

  it('create rejects duplicate library names', async () => {
    libraryRepo.findByName.mockResolvedValue([{ id: 9 }]);

    await expect(service.create({ name: 'Dup', folders: ['/x'] } as any)).rejects.toBeInstanceOf(ConflictException);
  });

  it('update synchronizes folder additions and removals', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 3, name: 'Current' }]);
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
  });

  it('remove deletes library and cleans related cover directories', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 4, name: 'L' }]);
    libraryRepo.findBookIdsByLibrary.mockResolvedValue([{ id: 101 }, { id: 102 }]);

    await service.remove(4);

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

    mockReaddir.mockImplementation(async (path: Parameters<typeof readdir>[0]) => {
      if (path === '/books/new') {
        return [dirent('a.epub', 'file'), dirent('.hidden.epub', 'file'), dirent('sub', 'dir')] as any;
      }
      if (path === '/books/new/sub') {
        return [dirent('b.pdf', 'file'), dirent('note.txt', 'file')] as any;
      }
      return [] as any;
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
