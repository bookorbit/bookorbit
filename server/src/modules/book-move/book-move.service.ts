import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { access, constants as fsConstants, copyFile, link, mkdir, readdir, rmdir, unlink } from 'fs/promises';
import { dirname, extname, isAbsolute, join, relative } from 'path';

import type { MoveBookOutcome } from '@bookorbit/types';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { RequestUser } from '../../common/types/request-user';
import { FileLockService, bookOperationLockKey } from '../file-write/file-lock.service';
import { FileRenameService } from '../file-write/file-rename.service';
import { LibraryService } from '../library/library.service';
import { ScanGateway } from '../scanner/scan.gateway';
import { ScannerService } from '../scanner/scanner.service';
import { SelfWriteRegistry } from '../../common/services/self-write-registry.service';
import type { BookMoveBookData, BookMoveFileUpdate, BookMoveFolder, BookMoveLibrary } from './book-move.repository';
import { BookMoveRepository } from './book-move.repository';

const BOOK_MOVE_EVENT = 'book.move';

@Injectable()
export class BookMoveService {
  private readonly logger = new Logger(BookMoveService.name);

  constructor(
    private readonly moveRepo: BookMoveRepository,
    private readonly libraryService: LibraryService,
    private readonly lockService: FileLockService,
    private readonly fileRenameService: FileRenameService,
    private readonly scanGateway: ScanGateway,
    private readonly scannerService: ScannerService,
    private readonly selfWriteRegistry: SelfWriteRegistry,
  ) {}

  async moveBooks(bookIds: number[], targetLibraryId: number, targetFolderId: number | undefined, user: RequestUser): Promise<MoveBookOutcome[]> {
    const library = await this.moveRepo.findLibrary(targetLibraryId);
    if (!library) throw new BadRequestException(`Library ${targetLibraryId} not found`);

    // Moving writes files into the target library, so viewer access is not
    // enough; every other write path requires editor level.
    await this.libraryService.verifyUserAccessLevel(user.id, targetLibraryId, 'editor', user.isSuperuser);
    const folder = await this.resolveTargetFolder(targetLibraryId, targetFolderId);

    const results: MoveBookOutcome[] = [];
    const movedBySourceLibrary = new Map<number, number[]>();
    for (const bookId of bookIds) {
      results.push(
        await this.lockService.withLock(bookOperationLockKey(bookId), () => this.moveBook(bookId, library, folder, user, movedBySourceLibrary)),
      );
    }

    for (const [fromLibraryId, movedIds] of movedBySourceLibrary) {
      // A move can race the source library's unavailable-books debounce; the
      // scanner's own transfer path cancels the pending notification too.
      this.scannerService.cancelBooksUnavailableNotification(fromLibraryId, movedIds);
      this.scanGateway.emitBookTransferred({ fromLibraryId, toLibraryId: library.id, bookIds: movedIds });
    }
    return results;
  }

  private async resolveTargetFolder(libraryId: number, folderId: number | undefined): Promise<BookMoveFolder> {
    if (folderId !== undefined) {
      const folder = await this.moveRepo.findFolder(folderId);
      if (!folder || folder.libraryId !== libraryId) {
        throw new BadRequestException(`Folder ${folderId} does not belong to library ${libraryId}`);
      }
      return folder;
    }

    const folders = await this.moveRepo.findFoldersByLibrary(libraryId);
    if (folders.length !== 1) {
      throw new BadRequestException('targetFolderId is required when the target library does not have exactly one folder');
    }
    return folders[0];
  }

  private async moveBook(
    bookId: number,
    library: BookMoveLibrary,
    folder: BookMoveFolder,
    user: RequestUser,
    movedBySourceLibrary: Map<number, number[]>,
  ): Promise<MoveBookOutcome> {
    const book = await this.moveRepo.findBookForMove(bookId);
    if (!book) return { bookId, status: 'failed', reason: 'book not found' };

    try {
      await this.libraryService.verifyUserAccess(user.id, book.libraryId, user.isSuperuser);
    } catch (error) {
      if (error instanceof ForbiddenException) {
        return { bookId, status: 'failed', reason: 'no access to source library' };
      }
      const message = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.error(
        `[${BOOK_MOVE_EVENT}] bookId=${bookId} userId=${user.id} errorClass=${error instanceof Error ? error.constructor.name : 'unknown'} error="${message}" - source library access check failed`,
      );
      return { bookId, status: 'failed', reason: 'source library access check failed' };
    }

    if (book.status === 'processing') return { bookId, status: 'skipped', reason: 'book is processing' };
    if (book.status === 'missing') return { bookId, status: 'skipped', reason: 'book files are missing' };
    if (book.libraryId === library.id && book.libraryFolderId === folder.id) {
      return { bookId, status: 'skipped', reason: 'already in target library' };
    }

    if (library.allowedFormats.length > 0) {
      for (const file of book.files) {
        if (file.role !== 'primary' && file.role !== 'content') continue;
        const format = (file.format ?? extname(file.absolutePath).slice(1)).toLowerCase();
        if (!library.allowedFormats.includes(format)) {
          return { bookId, status: 'skipped', reason: `format ${format} not allowed in target library` };
        }
      }
    }

    const fileUpdates: BookMoveFileUpdate[] = book.files.map((file) => {
      const relPath = file.relPath ?? relative(book.libraryFolderPath, file.absolutePath);
      return { id: file.id, absolutePath: join(folder.path, relPath), relPath };
    });
    const newFolderPath = join(folder.path, relative(book.libraryFolderPath, book.folderPath));

    // A stored relPath (or a file row outside its folder root) can resolve to
    // "../..", which would make the move write outside the target library. The
    // folder path may equal the folder root itself (flat libraries), file
    // paths must be strictly inside it.
    const escapes =
      fileUpdates.some((update) => !this.isContainedIn(folder.path, update.absolutePath)) || !this.isAtOrContainedIn(folder.path, newFolderPath);
    if (escapes) {
      this.logger.error(`[${BOOK_MOVE_EVENT}] bookId=${bookId} toFolderId=${folder.id} - resolved target path escapes the target folder`);
      return { bookId, status: 'failed', reason: 'file path escapes target folder' };
    }

    const existingPaths = await this.moveRepo.findExistingPaths(fileUpdates.map((update) => update.absolutePath));
    for (const update of fileUpdates) {
      const owner = existingPaths.get(update.absolutePath);
      if (owner !== undefined && owner !== bookId) {
        return { bookId, status: 'skipped', reason: 'target path already taken by another book' };
      }
    }

    for (const update of fileUpdates) {
      if (await this.pathExists(update.absolutePath)) {
        return { bookId, status: 'skipped', reason: 'target path already exists on disk' };
      }
    }

    try {
      await this.moveRepo.applyMove(bookId, { libraryId: library.id, libraryFolderId: folder.id, folderPath: newFolderPath }, fileUpdates);
    } catch (error) {
      const message = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.error(
        `[${BOOK_MOVE_EVENT}] bookId=${bookId} errorClass=${error instanceof Error ? error.constructor.name : 'unknown'} error="${message}" - database re-parent failed`,
      );
      return { bookId, status: 'failed', reason: 'database update failed' };
    }

    const moved: Array<{ from: string; to: string }> = [];
    // Suppress watcher events for every touched path: without this the source
    // library's watcher sees unlinks and the target's sees adds for a book
    // whose row has already been re-parented, racing missing-marking and
    // duplicate detection.
    const suppressPaths = this.buildSuppressedMovePaths(book, fileUpdates, folder.path, newFolderPath);
    this.selfWriteRegistry.begin(suppressPaths);
    try {
      try {
        for (let i = 0; i < book.files.length; i++) {
          const from = book.files[i].absolutePath;
          const to = fileUpdates[i].absolutePath;
          if (from === to) continue;
          await mkdir(dirname(to), { recursive: true });
          await this.moveFile(from, to);
          moved.push({ from, to });
        }
      } catch (error) {
        const rolledBack = await this.rollback(bookId, book, moved, error);
        const reason = error instanceof Error ? error.message : String(error);
        return { bookId, status: 'failed', reason: rolledBack ? reason : `${reason} (rollback incomplete, manual check required)` };
      }

      for (const { from } of moved) {
        await this.cleanupEmptyDirsUpTo(dirname(from), book.libraryFolderPath);
      }
      await this.cleanupEmptyDirsUpTo(book.folderPath, book.libraryFolderPath);
    } finally {
      this.selfWriteRegistry.end(suppressPaths);
    }

    const movedFromSource = movedBySourceLibrary.get(book.libraryId) ?? [];
    movedFromSource.push(bookId);
    movedBySourceLibrary.set(book.libraryId, movedFromSource);

    this.fileRenameService.scheduleRename(bookId, user.id);
    this.logger.log(
      `[${BOOK_MOVE_EVENT}] bookId=${bookId} userId=${user.id} fromLibraryId=${book.libraryId} toLibraryId=${library.id} toFolderId=${folder.id} - book moved`,
    );
    return { bookId, status: 'moved' };
  }

  private async rollback(bookId: number, book: BookMoveBookData, moved: Array<{ from: string; to: string }>, cause: unknown): Promise<boolean> {
    let rollbackOk = true;
    for (const { from, to } of [...moved].reverse()) {
      try {
        await this.moveFile(to, from);
      } catch (rollbackError) {
        rollbackOk = false;
        const causeMessage = sanitizeLogValue(cause instanceof Error ? cause.message : String(cause));
        const rollbackMessage = sanitizeLogValue(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
        this.logger.error(
          `[${BOOK_MOVE_EVENT}] bookId=${bookId} error="${causeMessage}" rollbackError="${rollbackMessage}" - failed to move file back during rollback`,
        );
      }
    }

    const fileUpdates: BookMoveFileUpdate[] = book.files.map((file) => ({
      id: file.id,
      absolutePath: file.absolutePath,
      relPath: file.relPath ?? relative(book.libraryFolderPath, file.absolutePath),
    }));
    try {
      await this.moveRepo.applyMove(
        bookId,
        { libraryId: book.libraryId, libraryFolderId: book.libraryFolderId, folderPath: book.folderPath },
        fileUpdates,
      );
    } catch (rollbackError) {
      rollbackOk = false;
      const rollbackMessage = sanitizeLogValue(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
      this.logger.error(`[${BOOK_MOVE_EVENT}] bookId=${bookId} rollbackError="${rollbackMessage}" - failed to restore book rows during rollback`);
    }
    return rollbackOk;
  }

  private async moveFile(from: string, to: string): Promise<void> {
    // rename(2) silently overwrites the destination. link+unlink (or
    // COPYFILE_EXCL on filesystems without hardlinks) makes a concurrent move
    // that resolved the same target path fail with EEXIST instead of
    // clobbering the other book's file.
    try {
      await link(from, to);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EXDEV' || code === 'EPERM' || code === 'ENOTSUP' || code === 'EACCES') {
        await copyFile(from, to, fsConstants.COPYFILE_EXCL);
      } else {
        throw err;
      }
    }
    await unlink(from);
  }

  private buildSuppressedMovePaths(book: BookMoveBookData, fileUpdates: BookMoveFileUpdate[], targetRoot: string, newFolderPath: string): string[] {
    const paths = new Set<string>();
    const addWithParents = (path: string, root: string) => {
      paths.add(path);
      let current = dirname(path);
      while (this.isContainedIn(root, current)) {
        paths.add(current);
        current = dirname(current);
      }
    };
    for (let i = 0; i < book.files.length; i++) {
      addWithParents(book.files[i].absolutePath, book.libraryFolderPath);
      addWithParents(fileUpdates[i].absolutePath, targetRoot);
    }
    if (this.isContainedIn(book.libraryFolderPath, book.folderPath)) paths.add(book.folderPath);
    if (this.isContainedIn(targetRoot, newFolderPath)) paths.add(newFolderPath);
    return [...paths];
  }

  private isContainedIn(root: string, target: string): boolean {
    const rel = relative(root, target);
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
  }

  private isAtOrContainedIn(root: string, target: string): boolean {
    return relative(root, target) === '' || this.isContainedIn(root, target);
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  // Removes empty directories from startDir upward, but never the library
  // folder root itself: for flat libraries books.folderPath IS the folder root,
  // and deleting it would break the library until someone recreates it.
  private async cleanupEmptyDirsUpTo(startDir: string, stopDir: string): Promise<void> {
    let current = startDir;
    while (this.isContainedIn(stopDir, current)) {
      const removed = await this.tryRemoveEmptyDir(current);
      if (!removed) return;
      current = dirname(current);
    }
  }

  private async tryRemoveEmptyDir(dirPath: string): Promise<boolean> {
    try {
      const entries = await readdir(dirPath);
      if (entries.length === 0) {
        await rmdir(dirPath);
        return true;
      }
    } catch {
      // Best effort.
    }
    return false;
  }
}
