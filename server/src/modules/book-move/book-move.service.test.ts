import { ForbiddenException, BadRequestException } from '@nestjs/common';
import type { MockedFunction } from 'vitest';
import { access, constants as fsConstants, copyFile, link, mkdir, readdir, rmdir, unlink } from 'fs/promises';

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return {
    ...actual,
    access: vi.fn(),
    copyFile: vi.fn(),
    mkdir: vi.fn(),
    readdir: vi.fn(),
    link: vi.fn(),
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
const mockLink = link as MockedFunction<typeof link>;
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
  const libraryService = { verifyUserAccess: vi.fn().mockResolvedValue(undefined), verifyUserAccessLevel: vi.fn().mockResolvedValue(undefined) };
  const lockService = { withLock: vi.fn((_key: string, fn: () => unknown) => fn()) };
  const fileRenameService = { scheduleRename: vi.fn() };
  const scanGateway = { emitBookTransferred: vi.fn() };
  const scannerService = { cancelBooksUnavailableNotification: vi.fn() };
  const selfWriteRegistry = { begin: vi.fn(), end: vi.fn() };

  const service = new BookMoveService(
    repo as never,
    libraryService as never,
    lockService as never,
    fileRenameService as never,
    scanGateway as never,
    scannerService as never,
    selfWriteRegistry as never,
  );

  return { service, repo, libraryService, lockService, fileRenameService, scanGateway, scannerService, selfWriteRegistry };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default disk state: no target paths exist, source dirs empty after move.
  mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  mockMkdir.mockResolvedValue(undefined);
  mockLink.mockResolvedValue(undefined);
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
      expect(mockLink).toHaveBeenCalledWith('/src-lib/Frank Herbert/Dune/Dune.epub', '/dst-lib/Frank Herbert/Dune/Dune.epub');
      expect(mockLink).toHaveBeenCalledWith('/src-lib/Frank Herbert/Dune/cover.jpg', '/dst-lib/Frank Herbert/Dune/cover.jpg');
    });

    it('schedules a pattern rename in the target library after a successful move', async () => {
      const { service, fileRenameService } = makeService();

      await service.moveBooks([5], 3, 9, makeUser());

      expect(fileRenameService.scheduleRename).toHaveBeenCalledWith(5, 7);
    });

    it('requires editor access on the target library and viewer access on the source', async () => {
      const { service, libraryService } = makeService();

      await service.moveBooks([5], 3, 9, makeUser());

      expect(libraryService.verifyUserAccessLevel).toHaveBeenCalledWith(7, 3, 'editor', false);
      expect(libraryService.verifyUserAccess).toHaveBeenCalledWith(7, 1, false);
    });

    it('rejects the whole request when the user lacks editor access to the target library', async () => {
      const { service, libraryService, repo } = makeService();
      libraryService.verifyUserAccessLevel.mockRejectedValueOnce(new ForbiddenException('Insufficient library access level'));

      await expect(service.moveBooks([5], 3, 9, makeUser())).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.applyMove).not.toHaveBeenCalled();
    });

    it('fails a single book (not the batch) when the user has no access to its source library', async () => {
      const { service, libraryService } = makeService();
      libraryService.verifyUserAccess.mockRejectedValueOnce(new ForbiddenException()); // source library

      const results = await service.moveBooks([5], 3, 9, makeUser());

      expect(results).toEqual([{ bookId: 5, status: 'failed', reason: 'no_source_access' }]);
    });

    it('skips books whose files are missing without touching the database', async () => {
      const { service, repo } = makeService();
      repo.findBookForMove.mockResolvedValue(makeBook({ status: 'missing' }));

      const results = await service.moveBooks([5], 3, 9, makeUser());

      expect(results).toEqual([{ bookId: 5, status: 'skipped', reason: 'book_missing' }]);
      expect(repo.applyMove).not.toHaveBeenCalled();
      expect(mockLink).not.toHaveBeenCalled();
    });

    it('fails a book whose resolved target path escapes the target folder', async () => {
      const { service, repo } = makeService();
      repo.findBookForMove.mockResolvedValue(
        makeBook({
          files: [
            {
              id: 10,
              absolutePath: '/elsewhere/Dune.epub',
              relPath: '../../elsewhere/Dune.epub',
              format: 'epub',
              role: 'primary',
            },
          ],
        }),
      );

      const results = await service.moveBooks([5], 3, 9, makeUser());

      expect(results).toEqual([{ bookId: 5, status: 'failed', reason: 'path_escapes_target' }]);
      expect(repo.applyMove).not.toHaveBeenCalled();
      expect(mockLink).not.toHaveBeenCalled();
    });

    it('never removes the library folder root when cleaning up a flat book', async () => {
      const { service, repo } = makeService();
      repo.findBookForMove.mockResolvedValue(
        makeBook({
          folderPath: '/src-lib',
          files: [
            {
              id: 10,
              absolutePath: '/src-lib/Dune.epub',
              relPath: 'Dune.epub',
              format: 'epub',
              role: 'primary',
            },
          ],
        }),
      );

      const results = await service.moveBooks([5], 3, 9, makeUser());

      expect(results).toEqual([{ bookId: 5, status: 'moved' }]);
      expect(mockRmdir).not.toHaveBeenCalled();
    });

    it('cleans up nested empty directories up to but excluding the folder root', async () => {
      const { service, repo } = makeService();
      repo.findBookForMove.mockResolvedValue(makeBook());

      const results = await service.moveBooks([5], 3, 9, makeUser());

      expect(results).toEqual([{ bookId: 5, status: 'moved' }]);
      expect(mockRmdir).toHaveBeenCalledWith('/src-lib/Frank Herbert/Dune');
      expect(mockRmdir).toHaveBeenCalledWith('/src-lib/Frank Herbert');
      expect(mockRmdir).not.toHaveBeenCalledWith('/src-lib');
    });

    it('fails a single book with a distinct reason when the source access check errors unexpectedly', async () => {
      const { service, libraryService } = makeService();
      libraryService.verifyUserAccess.mockRejectedValueOnce(new Error('connection reset')); // source library, infra error

      const results = await service.moveBooks([5], 3, 9, makeUser());

      expect(results).toEqual([{ bookId: 5, status: 'failed', reason: 'source_access_check_failed' }]);
    });

    it('fails a single book (not the batch) when the database re-parent throws', async () => {
      const { service, repo, scanGateway } = makeService();
      repo.findBookForMove.mockResolvedValueOnce(makeBook()).mockResolvedValueOnce(makeBook({ id: 6 }));
      repo.applyMove.mockRejectedValueOnce(new Error('connection terminated'));

      const results = await service.moveBooks([5, 6], 3, 9, makeUser());

      expect(results).toEqual([
        { bookId: 5, status: 'failed', reason: 'database_update_failed' },
        { bookId: 6, status: 'moved' },
      ]);
      expect(scanGateway.emitBookTransferred).toHaveBeenCalledWith({ fromLibraryId: 1, toLibraryId: 3, bookIds: [6] });
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
        { bookId: 404, status: 'failed', reason: 'book_not_found' },
        { bookId: 5, status: 'moved' },
      ]);
    });

    it('skips books that are still processing', async () => {
      const { service, repo } = makeService();
      repo.findBookForMove.mockResolvedValue(makeBook({ status: 'processing' }));

      const results = await service.moveBooks([5], 3, 9, makeUser());

      expect(results).toEqual([{ bookId: 5, status: 'skipped', reason: 'book_processing' }]);
      expect(repo.applyMove).not.toHaveBeenCalled();
    });

    it('skips books already in the target folder', async () => {
      const { service, repo } = makeService();
      repo.findBookForMove.mockResolvedValue(makeBook({ libraryId: 3, libraryFolderId: 9 }));

      const results = await service.moveBooks([5], 3, 9, makeUser());

      expect(results).toEqual([{ bookId: 5, status: 'skipped', reason: 'already_in_target' }]);
      expect(repo.applyMove).not.toHaveBeenCalled();
    });

    it('skips books whose content format is not allowed in the target library', async () => {
      const { service, repo } = makeService();
      repo.findLibrary.mockResolvedValue({ id: 3, allowedFormats: ['pdf', 'cbz'] });

      const results = await service.moveBooks([5], 3, 9, makeUser());

      expect(results).toEqual([{ bookId: 5, status: 'skipped', reason: 'format_not_allowed' }]);
      expect(repo.applyMove).not.toHaveBeenCalled();
    });

    it('skips when a target path is already registered to another book', async () => {
      const { service, repo } = makeService();
      repo.findExistingPaths.mockResolvedValue(new Map([['/dst-lib/Frank Herbert/Dune/Dune.epub', 77]]));

      const results = await service.moveBooks([5], 3, 9, makeUser());

      expect(results).toEqual([{ bookId: 5, status: 'skipped', reason: 'target_path_taken' }]);
      expect(repo.applyMove).not.toHaveBeenCalled();
    });

    it('skips when a target path already exists on disk', async () => {
      const { service, repo } = makeService();
      mockAccess.mockResolvedValue(undefined); // everything "exists"

      const results = await service.moveBooks([5], 3, 9, makeUser());

      expect(results).toEqual([{ bookId: 5, status: 'skipped', reason: 'target_path_exists' }]);
      expect(repo.applyMove).not.toHaveBeenCalled();
    });

    it('falls back to exclusive copy+unlink when hardlinking fails with EXDEV (cross-device move)', async () => {
      const { service } = makeService();
      mockLink.mockRejectedValue(Object.assign(new Error('cross-device'), { code: 'EXDEV' }));
      mockCopyFile.mockResolvedValue(undefined);
      mockUnlink.mockResolvedValue(undefined);

      const results = await service.moveBooks([5], 3, 9, makeUser());

      expect(results).toEqual([{ bookId: 5, status: 'moved' }]);
      expect(mockCopyFile).toHaveBeenCalledWith(
        '/src-lib/Frank Herbert/Dune/Dune.epub',
        '/dst-lib/Frank Herbert/Dune/Dune.epub',
        fsConstants.COPYFILE_EXCL,
      );
      expect(mockUnlink).toHaveBeenCalledWith('/src-lib/Frank Herbert/Dune/Dune.epub');
    });

    it('fails the book instead of overwriting when a concurrent move already created the target file', async () => {
      const { service } = makeService();
      mockLink.mockRejectedValueOnce(Object.assign(new Error('file exists'), { code: 'EEXIST' }));

      const results = await service.moveBooks([5], 3, 9, makeUser());

      expect(results).toEqual([{ bookId: 5, status: 'failed', reason: 'file_move_failed' }]);
      expect(mockCopyFile).not.toHaveBeenCalled();
    });

    it('suppresses watcher events for all touched paths during the physical move', async () => {
      const { service, selfWriteRegistry } = makeService();

      await service.moveBooks([5], 3, 9, makeUser());

      expect(selfWriteRegistry.begin).toHaveBeenCalledTimes(1);
      const paths = selfWriteRegistry.begin.mock.calls[0][0] as string[];
      expect(paths).toEqual(
        expect.arrayContaining([
          '/src-lib/Frank Herbert/Dune/Dune.epub',
          '/dst-lib/Frank Herbert/Dune/Dune.epub',
          '/src-lib/Frank Herbert/Dune',
          '/src-lib/Frank Herbert',
          '/dst-lib/Frank Herbert/Dune',
          '/dst-lib/Frank Herbert',
        ]),
      );
      expect(paths).not.toContain('/src-lib');
      expect(paths).not.toContain('/dst-lib');
      expect(selfWriteRegistry.end).toHaveBeenCalledWith(paths);
    });

    it('cancels the source library unavailable notification for moved books', async () => {
      const { service, scannerService } = makeService();

      await service.moveBooks([5], 3, 9, makeUser());

      expect(scannerService.cancelBooksUnavailableNotification).toHaveBeenCalledWith(1, [5]);
    });

    it('rolls back the DB update and already-moved files when a physical move fails', async () => {
      const { service, repo } = makeService();
      const book = makeBook();
      repo.findBookForMove.mockResolvedValue(book);
      mockLink
        .mockResolvedValueOnce(undefined) // first file moves fine
        .mockRejectedValueOnce(Object.assign(new Error('disk full'), { code: 'ENOSPC' })) // second file fails
        .mockResolvedValueOnce(undefined); // rollback of first file

      const results = await service.moveBooks([5], 3, 9, makeUser());

      expect(results).toEqual([{ bookId: 5, status: 'failed', reason: 'file_move_failed' }]);
      // Rollback: file 10 moved back.
      expect(mockLink).toHaveBeenCalledWith('/dst-lib/Frank Herbert/Dune/Dune.epub', '/src-lib/Frank Herbert/Dune/Dune.epub');
      // Rollback: DB restored to source library values.
      expect(repo.applyMove).toHaveBeenLastCalledWith(5, { libraryId: 1, libraryFolderId: 2, folderPath: '/src-lib/Frank Herbert/Dune' }, [
        { id: 10, absolutePath: '/src-lib/Frank Herbert/Dune/Dune.epub', relPath: 'Frank Herbert/Dune/Dune.epub' },
        { id: 11, absolutePath: '/src-lib/Frank Herbert/Dune/cover.jpg', relPath: 'Frank Herbert/Dune/cover.jpg' },
      ]);
    });

    it('flags the outcome when the rollback itself fails and the book may be inconsistent', async () => {
      const { service, repo } = makeService();
      repo.findBookForMove.mockResolvedValue(makeBook());
      mockLink
        .mockResolvedValueOnce(undefined) // first file moves fine
        .mockRejectedValueOnce(Object.assign(new Error('disk full'), { code: 'ENOSPC' })) // second file fails
        .mockRejectedValueOnce(new Error('permission denied')); // rollback of first file fails too

      const results = await service.moveBooks([5], 3, 9, makeUser());

      expect(results).toEqual([{ bookId: 5, status: 'failed', reason: 'file_move_failed_rollback_incomplete' }]);
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

    it('emits a book:transferred event per source library so open views refresh', async () => {
      const { service, repo, scanGateway } = makeService();
      repo.findBookForMove.mockResolvedValueOnce(makeBook()).mockResolvedValueOnce(
        makeBook({
          id: 6,
          libraryId: 2,
          libraryFolderId: 4,
          libraryFolderPath: '/other-lib',
          folderPath: '/other-lib/Solo/Book',
          files: [{ id: 20, absolutePath: '/other-lib/Solo/Book/Book.epub', relPath: 'Solo/Book/Book.epub', format: 'epub', role: 'primary' }],
        }),
      );

      await service.moveBooks([5, 6], 3, 9, makeUser());

      expect(scanGateway.emitBookTransferred).toHaveBeenCalledTimes(2);
      expect(scanGateway.emitBookTransferred).toHaveBeenCalledWith({ fromLibraryId: 1, toLibraryId: 3, bookIds: [5] });
      expect(scanGateway.emitBookTransferred).toHaveBeenCalledWith({ fromLibraryId: 2, toLibraryId: 3, bookIds: [6] });
    });

    it('does not emit a transfer event when no book was moved', async () => {
      const { service, repo, scanGateway } = makeService();
      repo.findBookForMove.mockResolvedValue(makeBook({ status: 'processing' }));

      await service.moveBooks([5], 3, 9, makeUser());

      expect(scanGateway.emitBookTransferred).not.toHaveBeenCalled();
    });

    it('serializes each book move behind the shared book operation lock', async () => {
      const { service, lockService } = makeService();

      await service.moveBooks([5], 3, 9, makeUser());

      expect(lockService.withLock).toHaveBeenCalledWith('book:5', expect.any(Function));
    });
  });
});
