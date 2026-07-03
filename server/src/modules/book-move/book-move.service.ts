import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { access, copyFile, mkdir, readdir, rename as fsRename, rmdir, unlink } from 'fs/promises';
import { dirname, extname, join, relative } from 'path';

import type { MoveBookOutcome } from '@bookorbit/types';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { RequestUser } from '../../common/types/request-user';
import { FileLockService, bookOperationLockKey } from '../file-write/file-lock.service';
import { FileRenameService } from '../file-write/file-rename.service';
import { LibraryService } from '../library/library.service';
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
  ) {}

  async moveBooks(bookIds: number[], targetLibraryId: number, targetFolderId: number | undefined, user: RequestUser): Promise<MoveBookOutcome[]> {
    const library = await this.moveRepo.findLibrary(targetLibraryId);
    if (!library) throw new BadRequestException(`Library ${targetLibraryId} not found`);

    await this.libraryService.verifyUserAccess(user.id, targetLibraryId, user.isSuperuser);
    const folder = await this.resolveTargetFolder(targetLibraryId, targetFolderId);

    const results: MoveBookOutcome[] = [];
    for (const bookId of bookIds) {
      results.push(await this.lockService.withLock(bookOperationLockKey(bookId), () => this.moveBook(bookId, library, folder, user)));
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

  private async moveBook(bookId: number, library: BookMoveLibrary, folder: BookMoveFolder, user: RequestUser): Promise<MoveBookOutcome> {
    const book = await this.moveRepo.findBookForMove(bookId);
    if (!book) return { bookId, status: 'failed', reason: 'book not found' };

    try {
      await this.libraryService.verifyUserAccess(user.id, book.libraryId, user.isSuperuser);
    } catch {
      return { bookId, status: 'failed', reason: 'no access to source library' };
    }

    if (book.status === 'processing') return { bookId, status: 'skipped', reason: 'book is processing' };
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

    await this.moveRepo.applyMove(bookId, { libraryId: library.id, libraryFolderId: folder.id, folderPath: newFolderPath }, fileUpdates);

    const moved: Array<{ from: string; to: string }> = [];
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
      await this.rollback(bookId, book, moved, error);
      const reason = error instanceof Error ? error.message : String(error);
      return { bookId, status: 'failed', reason };
    }

    for (const { from } of moved) {
      await this.tryRemoveEmptyDir(dirname(from));
    }
    await this.tryRemoveEmptyDir(book.folderPath);

    this.fileRenameService.scheduleRename(bookId, user.id);
    this.logger.log(
      `[${BOOK_MOVE_EVENT}] bookId=${bookId} userId=${user.id} fromLibraryId=${book.libraryId} toLibraryId=${library.id} toFolderId=${folder.id} - book moved`,
    );
    return { bookId, status: 'moved' };
  }

  private async rollback(bookId: number, book: BookMoveBookData, moved: Array<{ from: string; to: string }>, cause: unknown): Promise<void> {
    for (const { from, to } of [...moved].reverse()) {
      try {
        await this.moveFile(to, from);
      } catch (rollbackError) {
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
      const rollbackMessage = sanitizeLogValue(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
      this.logger.error(`[${BOOK_MOVE_EVENT}] bookId=${bookId} rollbackError="${rollbackMessage}" - failed to restore book rows during rollback`);
    }
  }

  private async moveFile(from: string, to: string): Promise<void> {
    try {
      await fsRename(from, to);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
        await copyFile(from, to);
        await unlink(from);
        return;
      }
      throw err;
    }
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  private async tryRemoveEmptyDir(dirPath: string): Promise<void> {
    try {
      const entries = await readdir(dirPath);
      if (entries.length === 0) {
        await rmdir(dirPath);
      }
    } catch {
      // Best effort.
    }
  }
}
