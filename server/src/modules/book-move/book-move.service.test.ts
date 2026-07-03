import { ForbiddenException, BadRequestException } from '@nestjs/common';
import type { MockedFunction } from 'vitest';
import { access, copyFile, mkdir, readdir, rename as fsRename, rmdir, unlink } from 'fs/promises';

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return {
    ...actual,
    access: vi.fn(),
    copyFile: vi.fn(),
    mkdir: vi.fn(),
    readdir: vi.fn(),
    rename: vi.fn(),
    rmdir: vi.fn(),
    unlink: vi.fn(),
  };
});

import type { RequestUser } from '../../common/types/request-user';
import type { BookMoveBookData, BookMoveFolder, BookMoveLibrary } from './book-move.repository';
import { BookMoveService } from './book-move.service';

const mockAccess = access as MockedFunction<typeof access>;
const mockCopyFile = copyFile as MockedFunction<typeof copyFile>;
const mockMkdir = mkdir as MockedFunction<typeof mkdir>;
const mockReaddir = readdir as MockedFunction<typeof readdir>;
const mockRename = fsRename as MockedFunction<typeof fsRename>;
const mockRmdir = rmdir as MockedFunction<typeof rmdir>;
const mockUnlink = unlink as MockedFunction<typeof unlink>;

type BookOverrides = Partial<Omit<BookMoveBookData, 'files'>> & { files?: BookMoveBookData['files'] };

function makeBook(overrides: BookOverrides = {}): BookMoveBookData {
  return {
    id: 5,
    libraryId: 1,
    libraryFolderId: 2,
    libraryFolderPath: '/src-lib',
    folderPath: '/src-lib/Frank Herbert/Dune',
    status: 'present',
    files: overrides.files ?? [
      {
        id: 10,
        absolutePath: '/src-lib/Frank Herbert/Dune/Dune.epub',
        relPath: 'Frank Herbert/Dune/Dune.epub',
        format: 'epub',
        role: 'primary',
      },
      {
        id: 11,
        absolutePath: '/src-lib/Frank Herbert/Dune/cover.jpg',
        relPath: 'Frank Herbert/Dune/cover.jpg',
        format: null,
        role: 'extra',
      },
    ],
    ...overrides,
  };
}

function makeUser(): RequestUser {
  return {
    id: 7,
    username: 'reader',
    name: 'Reader',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
    contentFilters: null as unknown as RequestUser['contentFilters'],
  } as RequestUser;
}

const TARGET_LIBRARY: BookMoveLibrary = { id: 3, allowedFormats: [] };
const TARGET_FOLDER: BookMoveFolder = { id: 9, libraryId: 3, path: '/dst-lib' };

function makeService() {
  const repo = {
    findBookForMove: vi.fn().mockResolvedValue(makeBook()),
    findLibrary: vi.fn().mockResolvedValue(TARGET_LIBRARY),
    findFolder: vi.fn().mockResolvedValue(TARGET_FOLDER),
    findFoldersByLibrary: vi.fn().mockResolvedValue([TARGET_FOLDER]),
    findExistingPaths: vi.fn().mockResolvedValue(new Map()),
    applyMove: vi.fn().mockResolvedValue(undefined),
  };
  const libraryService = { verifyUserAccess: vi.fn().mockResolvedValue(undefined) };
  const lockService = { withLock: vi.fn((_key: string, fn: () => unknown) => fn()) };
  const fileRenameService = { scheduleRename: vi.fn() };

  const service = new BookMoveService(repo as never, libraryService as never, lockService as never, fileRenameService as never);

  return { service, repo, libraryService, lockService, fileRenameService };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default disk state: no target paths exist, source dirs empty after move.
  mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  mockMkdir.mockResolvedValue(undefined);
  mockRename.mockResolvedValue(undefined);
  mockReaddir.mockResolvedValue([] as never);
  mockRmdir.mockResolvedValue(undefined);
});

describe('BookMoveService', () => {
  describe('moveBooks', () => {
    it('re-parents the book in the DB and physically moves its files into the target folder', async () => {
      const { service, repo } = makeService();

      const results = await service.moveBooks([5], 3, 9, makeUser());

      expect(results).toEqual([{ bookId: 5, status: 'moved' }]);
      expect(repo.applyMove).toHaveBeenCalledWith(5, { libraryId: 3, libraryFolderId: 9, folderPath: '/dst-lib/Frank Herbert/Dune' }, [
        { id: 10, absolutePath: '/dst-lib/Frank Herbert/Dune/Dune.epub', relPath: 'Frank Herbert/Dune/Dune.epub' },
        { id: 11, absolutePath: '/dst-lib/Frank Herbert/Dune/cover.jpg', relPath: 'Frank Herbert/Dune/cover.jpg' },
      ]);
      expect(mockRename).toHaveBeenCalledWith('/src-lib/Frank Herbert/Dune/Dune.epub', '/dst-lib/Frank Herbert/Dune/Dune.epub');
      expect(mockRename).toHaveBeenCalledWith('/src-lib/Frank Herbert/Dune/cover.jpg', '/dst-lib/Frank Herbert/Dune/cover.jpg');
    });

    it('schedules a pattern rename in the target library after a successful move', async () => {
      const { service, fileRenameService } = makeService();

      await service.moveBooks([5], 3, 9, makeUser());

      expect(fileRenameService.scheduleRename).toHaveBeenCalledWith(5, 7);
    });

    it('verifies user access to both the source and the target library', async () => {
      const { service, libraryService } = makeService();

      await service.moveBooks([5], 3, 9, makeUser());

      expect(libraryService.verifyUserAccess).toHaveBeenCalledWith(7, 3, false);
      expect(libraryService.verifyUserAccess).toHaveBeenCalledWith(7, 1, false);
    });

    it('rejects the whole request when the user has no access to the target library', async () => {
      const { service, libraryService, repo } = makeService();
      libraryService.verifyUserAccess.mockRejectedValueOnce(new ForbiddenException());

      await expect(service.moveBooks([5], 3, 9, makeUser())).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.applyMove).not.toHaveBeenCalled();
    });

    it('fails a single book (not the batch) when the user has no access to its source library', async () => {
      const { service, libraryService } = makeService();
      libraryService.verifyUserAccess
        .mockResolvedValueOnce(undefined) // target library
        .mockRejectedValueOnce(new ForbiddenException()); // source library

      const results = await service.moveBooks([5], 3, 9, makeUser());

      expect(results).toEqual([{ bookId: 5, status: 'failed', reason: 'no access to source library' }]);
    });

    it('rejects when the target folder does not belong to the target library', async () => {
      const { service, repo } = makeService();
      repo.findFolder.mockResolvedValue({ id: 9, libraryId: 999, path: '/other' });

      await expect(service.moveBooks([5], 3, 9, makeUser())).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when the target library does not exist', async () => {
      const { service, repo } = makeService();
      repo.findLibrary.mockResolvedValue(null);

      await expect(service.moveBooks([5], 3, 9, makeUser())).rejects.toBeInstanceOf(BadRequestException);
    });

    it('uses the sole folder of the target library when no folder id is given', async () => {
      const { service, repo } = makeService();

      const results = await service.moveBooks([5], 3, undefined, makeUser());

      expect(repo.findFoldersByLibrary).toHaveBeenCalledWith(3);
      expect(results).toEqual([{ bookId: 5, status: 'moved' }]);
    });

    it('rejects when no folder id is given and the target library has several folders', async () => {
      const { service, repo } = makeService();
      repo.findFoldersByLibrary.mockResolvedValue([TARGET_FOLDER, { id: 12, libraryId: 3, path: '/dst-lib-2' }]);

      await expect(service.moveBooks([5], 3, undefined, makeUser())).rejects.toBeInstanceOf(BadRequestException);
    });

    it('reports a missing book as failed and keeps processing the rest', async () => {
      const { service, repo } = makeService();
      repo.findBookForMove.mockResolvedValueOnce(null).mockResolvedValueOnce(makeBook());

      const results = await service.moveBooks([404, 5], 3, 9, makeUser());

      expect(results).toEqual([
        { bookId: 404, status: 'failed', reason: 'book not found' },
        { bookId: 5, status: 'moved' },
      ]);
    });

    it('skips books that are still processing', async () => {
      const { service, repo } = makeService();
      repo.findBookForMove.mockResolvedValue(makeBook({ status: 'processing' }));

      const results = await service.moveBooks([5], 3, 9, makeUser());

      expect(results).toEqual([{ bookId: 5, status: 'skipped', reason: 'book is processing' }]);
      expect(repo.applyMove).not.toHaveBeenCalled();
    });

    it('skips books already in the target folder', async () => {
      const { service, repo } = makeService();
      repo.findBookForMove.mockResolvedValue(makeBook({ libraryId: 3, libraryFolderId: 9 }));

      const results = await service.moveBooks([5], 3, 9, makeUser());

      expect(results).toEqual([{ bookId: 5, status: 'skipped', reason: 'already in target library' }]);
      expect(repo.applyMove).not.toHaveBeenCalled();
    });

    it('skips books whose content format is not allowed in the target library', async () => {
      const { service, repo } = makeService();
      repo.findLibrary.mockResolvedValue({ id: 3, allowedFormats: ['pdf', 'cbz'] });

      const results = await service.moveBooks([5], 3, 9, makeUser());

      expect(results).toEqual([{ bookId: 5, status: 'skipped', reason: 'format epub not allowed in target library' }]);
      expect(repo.applyMove).not.toHaveBeenCalled();
    });

    it('skips when a target path is already registered to another book', async () => {
      const { service, repo } = makeService();
      repo.findExistingPaths.mockResolvedValue(new Map([['/dst-lib/Frank Herbert/Dune/Dune.epub', 77]]));

      const results = await service.moveBooks([5], 3, 9, makeUser());

      expect(results).toEqual([{ bookId: 5, status: 'skipped', reason: 'target path already taken by another book' }]);
      expect(repo.applyMove).not.toHaveBeenCalled();
    });

    it('skips when a target path already exists on disk', async () => {
      const { service, repo } = makeService();
      mockAccess.mockResolvedValue(undefined); // everything "exists"

      const results = await service.moveBooks([5], 3, 9, makeUser());

      expect(results).toEqual([{ bookId: 5, status: 'skipped', reason: 'target path already exists on disk' }]);
      expect(repo.applyMove).not.toHaveBeenCalled();
    });

    it('falls back to copy+unlink when rename fails with EXDEV (cross-device move)', async () => {
      const { service } = makeService();
      mockRename.mockRejectedValue(Object.assign(new Error('cross-device'), { code: 'EXDEV' }));
      mockCopyFile.mockResolvedValue(undefined);
      mockUnlink.mockResolvedValue(undefined);

      const results = await service.moveBooks([5], 3, 9, makeUser());

      expect(results).toEqual([{ bookId: 5, status: 'moved' }]);
      expect(mockCopyFile).toHaveBeenCalledWith('/src-lib/Frank Herbert/Dune/Dune.epub', '/dst-lib/Frank Herbert/Dune/Dune.epub');
      expect(mockUnlink).toHaveBeenCalledWith('/src-lib/Frank Herbert/Dune/Dune.epub');
    });

    it('rolls back the DB update and already-moved files when a physical move fails', async () => {
      const { service, repo } = makeService();
      const book = makeBook();
      repo.findBookForMove.mockResolvedValue(book);
      mockRename
        .mockResolvedValueOnce(undefined) // first file moves fine
        .mockRejectedValueOnce(Object.assign(new Error('disk full'), { code: 'ENOSPC' })) // second file fails
        .mockResolvedValueOnce(undefined); // rollback of first file

      const results = await service.moveBooks([5], 3, 9, makeUser());

      expect(results).toEqual([{ bookId: 5, status: 'failed', reason: 'disk full' }]);
      // Rollback: file 10 moved back.
      expect(mockRename).toHaveBeenCalledWith('/dst-lib/Frank Herbert/Dune/Dune.epub', '/src-lib/Frank Herbert/Dune/Dune.epub');
      // Rollback: DB restored to source library values.
      expect(repo.applyMove).toHaveBeenLastCalledWith(5, { libraryId: 1, libraryFolderId: 2, folderPath: '/src-lib/Frank Herbert/Dune' }, [
        { id: 10, absolutePath: '/src-lib/Frank Herbert/Dune/Dune.epub', relPath: 'Frank Herbert/Dune/Dune.epub' },
        { id: 11, absolutePath: '/src-lib/Frank Herbert/Dune/cover.jpg', relPath: 'Frank Herbert/Dune/cover.jpg' },
      ]);
    });

    it('computes relPath from absolute paths when a file has no stored relPath', async () => {
      const { service, repo } = makeService();
      repo.findBookForMove.mockResolvedValue(
        makeBook({
          files: [
            {
              id: 10,
              absolutePath: '/src-lib/Frank Herbert/Dune/Dune.epub',
              relPath: null,
              format: 'epub',
              role: 'primary',
            },
          ],
        }),
      );

      await service.moveBooks([5], 3, 9, makeUser());

      expect(repo.applyMove).toHaveBeenCalledWith(5, { libraryId: 3, libraryFolderId: 9, folderPath: '/dst-lib/Frank Herbert/Dune' }, [
        { id: 10, absolutePath: '/dst-lib/Frank Herbert/Dune/Dune.epub', relPath: 'Frank Herbert/Dune/Dune.epub' },
      ]);
    });

    it('serializes each book move behind the shared book operation lock', async () => {
      const { service, lockService } = makeService();

      await service.moveBooks([5], 3, 9, makeUser());

      expect(lockService.withLock).toHaveBeenCalledWith('book:5', expect.any(Function));
    });
  });
});
