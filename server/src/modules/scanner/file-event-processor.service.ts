import { Injectable, Logger } from '@nestjs/common';
import { readdir, stat } from 'fs/promises';
import { dirname, join, relative } from 'path';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';

import { classifyFile, DEFAULT_FORMAT_PRIORITY } from './lib/classify';
import { ScannerRepository } from './scanner.repository';

export type FileEventResult =
  | { type: 'book-missing'; libraryId: number; bookIds: number[] }
  | { type: 'book-restored'; libraryId: number; bookIds: number[] }
  | { type: 'book-moved'; libraryId: number; bookIds: number[] }
  | { type: 'noop' };

type FsStat = NonNullable<Awaited<ReturnType<typeof stat>>>;

@Injectable()
export class FileEventProcessorService {
  private readonly logger = new Logger(FileEventProcessorService.name);

  constructor(private readonly scannerRepo: ScannerRepository) {}

  async handleUnlink(absolutePath: string, scopeLibraryId?: number): Promise<FileEventResult> {
    const row = await this.scannerRepo.findBookFileByAbsolutePath(absolutePath, scopeLibraryId);
    if (!row) return { type: 'noop' };

    const { file, libraryId: rowLibraryId, primaryFileId } = row;

    const shouldReevaluate =
      file.id === primaryFileId ||
      // Legacy/inconsistent rows may have NULL primary_file_id while content files still exist.
      // Re-elect on content deletion so books do not get stuck without a selected file.
      (primaryFileId == null && file.role === 'content');

    if (!shouldReevaluate) {
      await this.scannerRepo.deleteBookFile(file.id);
      this.logger.log(
        `[scanner.file_event.unlink] [end] libraryId=${rowLibraryId} bookId=${file.bookId} path="${sanitizeLogValue(absolutePath)}" action=remove_non_selected - non-selected file removed`,
      );
      return { type: 'noop' };
    }

    const allFiles = await this.scannerRepo.findBookFilesByBookId(file.bookId);
    const remaining = allFiles.filter((f) => f.id !== file.id);
    const remainingContent = remaining.filter((f) => f.role === 'content').map((f) => ({ id: f.id, format: f.format, sizeBytes: f.sizeBytes }));

    if (remainingContent.length === 0) {
      // Keep the file record so inode-based rename detection in handleCreate still works.
      // If the file was truly deleted (not renamed), the next full scan will prune it.
      await this.scannerRepo.updateBookPrimaryFile(file.bookId, null);
      await this.scannerRepo.markBooksAsMissing([file.bookId]);
      this.logger.log(
        `[scanner.file_event.unlink] [end] libraryId=${rowLibraryId} bookId=${file.bookId} path="${sanitizeLogValue(absolutePath)}" action=mark_missing_selected_removed - selected content file removed`,
      );
      return { type: 'book-missing', libraryId: rowLibraryId, bookIds: [file.bookId] };
    }

    await this.scannerRepo.deleteBookFile(file.id);

    const settings = await this.scannerRepo.findLibrarySettings(rowLibraryId);
    const formatPriority = settings?.formatPriority ?? DEFAULT_FORMAT_PRIORITY;

    const winner = this.pickPrimaryFile(remainingContent, formatPriority);
    await this.scannerRepo.updateBookPrimaryFile(file.bookId, winner?.id ?? null);
    this.logger.log(
      `[scanner.file_event.unlink] [end] libraryId=${rowLibraryId} bookId=${file.bookId} path="${sanitizeLogValue(absolutePath)}" action=reselect_primary format=${winner?.format ?? 'unknown'} - primary file re-selected`,
    );
    return { type: 'book-restored', libraryId: rowLibraryId, bookIds: [file.bookId] };
  }

  async handleUnlinkDir(absolutePath: string, scopeLibraryId?: number): Promise<FileEventResult> {
    const matched = await this.scannerRepo.findBooksByFolderPath(absolutePath, scopeLibraryId);
    if (matched.length === 0) return { type: 'noop' };

    const bookIds = matched.map((b) => b.id);
    const matchedLibraryId = matched[0].libraryId;

    await this.scannerRepo.markBooksAsMissing(bookIds);

    this.logger.log(
      `[scanner.file_event.unlink_dir] [end] libraryId=${matchedLibraryId} path="${sanitizeLogValue(absolutePath)}" missingCount=${bookIds.length} - books marked missing for removed folder`,
    );
    return { type: 'book-missing', libraryId: matchedLibraryId, bookIds };
  }

  async handleCreate(absolutePath: string, scopeLibraryId?: number): Promise<FileEventResult> {
    const fileStat = await stat(absolutePath).catch(() => null);
    if (!fileStat) return { type: 'noop' };

    if (fileStat.isDirectory()) return this.handleCreateDir(absolutePath, scopeLibraryId);

    const { role, format } = classifyFile(absolutePath);
    if (role !== 'content') return { type: 'noop' };

    const existing = await this.scannerRepo.findBookFileByAbsolutePath(absolutePath, scopeLibraryId);
    if (existing) {
      // Check the file's own book first before searching for any missing book
      const ownBook = await this.scannerRepo.findBookById(existing.file.bookId);
      if (ownBook?.status === 'missing') {
        await this.scannerRepo.updateBookFile(existing.file.id, this.statToFileInfo(fileStat));
        await this.refreshPrimaryFile(ownBook.id, existing.libraryId);
        await this.scannerRepo.markBooksAsPresent([ownBook.id]);
        this.logger.log(
          `[scanner.file_event.create] [end] libraryId=${existing.libraryId} bookId=${ownBook.id} path="${sanitizeLogValue(absolutePath)}" action=restore_own_book - own book restored`,
        );
        return { type: 'book-restored', libraryId: existing.libraryId, bookIds: [ownBook.id] };
      }

      // Own book isn't missing - fall through to folder-level missing book search
      const book =
        (await this.scannerRepo.findMissingBookByFolderPath(dirname(absolutePath), scopeLibraryId)) ??
        (await this.scannerRepo.findMissingBookByFolderPath(absolutePath, scopeLibraryId));
      if (!book) return { type: 'noop' };

      await this.scannerRepo.updateBookFile(existing.file.id, this.statToFileInfo(fileStat));
      await this.refreshPrimaryFile(book.id, book.libraryId);
      await this.scannerRepo.markBooksAsPresent([book.id]);
      this.logger.log(
        `[scanner.file_event.create] [end] libraryId=${book.libraryId} bookId=${book.id} path="${sanitizeLogValue(absolutePath)}" action=restore_existing_file - book restored`,
      );
      return { type: 'book-restored', libraryId: book.libraryId, bookIds: [book.id] };
    }

    const folderPath = dirname(absolutePath);
    const book =
      (await this.scannerRepo.findMissingBookByFolderPath(folderPath, scopeLibraryId)) ??
      (await this.scannerRepo.findMissingBookByFolderPath(absolutePath, scopeLibraryId));
    if (book) {
      const libraryFolderPath = await this.scannerRepo.findLibraryFolderPath(book.libraryFolderId);
      await this.scannerRepo.createBookFile({
        bookId: book.id,
        libraryFolderId: book.libraryFolderId,
        absolutePath,
        relPath: libraryFolderPath ? relative(libraryFolderPath, absolutePath) : undefined,
        ...this.statToFileInfo(fileStat),
        format,
        role: 'content',
      });

      await this.refreshPrimaryFile(book.id, book.libraryId);
      await this.scannerRepo.markBooksAsPresent([book.id]);
      this.logger.log(
        `[scanner.file_event.create] [end] libraryId=${book.libraryId} bookId=${book.id} path="${sanitizeLogValue(absolutePath)}" action=restore_new_file_row - book restored`,
      );
      return { type: 'book-restored', libraryId: book.libraryId, bookIds: [book.id] };
    }

    // Before falling through to detectMovedFile (which may steal this file
    // for the wrong book), check if the inode belongs to a file already tracked by a
    // book at this folder path. This handles atomic-save patterns where an editor writes
    // a new inode for the same logical file.
    const ino = Number(fileStat.ino);
    if (ino !== 0) {
      const folderPath = dirname(absolutePath);
      const ownBook =
        (await this.scannerRepo.findMissingBookByFolderPath(folderPath, scopeLibraryId)) ??
        (await this.scannerRepo.findMissingBookByFolderPath(absolutePath, scopeLibraryId));
      if (ownBook) {
        const ownFiles = await this.scannerRepo.findBookFilesByBookId(ownBook.id);
        const matchingFile = ownFiles.find((f) => f.absolutePath === absolutePath);
        if (matchingFile) {
          await this.scannerRepo.updateBookFile(matchingFile.id, {
            ...this.statToFileInfo(fileStat),
            format,
            role: 'content',
          });
          await this.refreshPrimaryFile(ownBook.id, ownBook.libraryId);
          await this.scannerRepo.markBooksAsPresent([ownBook.id]);
          this.logger.log(
            `[scanner.file_event.create] [end] libraryId=${ownBook.libraryId} bookId=${ownBook.id} path="${sanitizeLogValue(absolutePath)}" action=restore_own_book_by_path - own book restored by path match`,
          );
          return { type: 'book-restored', libraryId: ownBook.libraryId, bookIds: [ownBook.id] };
        }
      }
    }

    return this.detectMovedFile(absolutePath, fileStat, scopeLibraryId);
  }

  async reconcileMissingBooks(libraryIds: number[]): Promise<FileEventResult[]> {
    const event = 'scanner.file_event.reconcile_missing';
    const startedAt = Date.now();
    const libraryIdsLabel = `[${libraryIds.join(',')}]`;
    this.logger.log(`[${event}] [start] libraryCount=${libraryIds.length} libraryIds=${libraryIdsLabel} - missing book reconcile started`);
    try {
      const missing = await this.scannerRepo.findMissingBooksForLibraries(libraryIds);
      if (missing.length === 0) {
        this.logger.log(
          `[${event}] [end] libraryCount=${libraryIds.length} libraryIds=${libraryIdsLabel} durationMs=${Date.now() - startedAt} candidateCount=0 restoredCount=0 - missing book reconcile completed`,
        );
        return [];
      }

      // Cache settings per library to avoid repeated DB lookups
      const settingsCache = new Map<number, { formatPriority: string[] }>();

      const results: FileEventResult[] = [];

      // Batch processing - group by library for potential future optimization
      for (const book of missing) {
        if (!settingsCache.has(book.libraryId)) {
          const settings = await this.scannerRepo.findLibrarySettings(book.libraryId);
          settingsCache.set(book.libraryId, {
            formatPriority: settings?.formatPriority ?? DEFAULT_FORMAT_PRIORITY,
          });
        }
        const cached = settingsCache.get(book.libraryId)!;
        const result = await this.tryRestoreBook(
          book as { id: number; libraryId: number; libraryFolderId: number; folderPath: string },
          cached.formatPriority,
        );
        if (result.type !== 'noop') results.push(result);
      }

      this.logger.log(
        `[${event}] [end] libraryCount=${libraryIds.length} libraryIds=${libraryIdsLabel} durationMs=${Date.now() - startedAt} candidateCount=${missing.length} restoredCount=${results.length} - missing book reconcile completed`,
      );
      return results;
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] libraryCount=${libraryIds.length} libraryIds=${libraryIdsLabel} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - missing book reconcile failed`,
      );
      throw err;
    }
  }

  private async tryRestoreBook(
    book: { id: number; libraryId: number; libraryFolderId: number; folderPath: string },
    cachedFormatPriority?: string[],
  ): Promise<FileEventResult> {
    const files = (await this.scannerRepo.findBookFilesByBookId(book.id))
      .filter((f) => f.role === 'content')
      .map((f) => ({ id: f.id, absolutePath: f.absolutePath, format: f.format, sizeBytes: f.sizeBytes }));
    const existingContent: ((typeof files)[number] & { stat: FsStat })[] = [];

    for (const file of files) {
      const s = await stat(file.absolutePath).catch(() => null);
      if (!s || !s.isFile()) continue;
      existingContent.push({ ...file, stat: s });
    }

    if (existingContent.length === 0) return { type: 'noop' };

    for (const file of existingContent) {
      await this.scannerRepo.updateBookFile(file.id, this.statToFileInfo(file.stat));
    }

    // Use cached formatPriority when available
    const formatPriority =
      cachedFormatPriority ?? (await this.scannerRepo.findLibrarySettings(book.libraryId))?.formatPriority ?? DEFAULT_FORMAT_PRIORITY;
    const winner = this.pickPrimaryFile(existingContent, formatPriority);

    await this.scannerRepo.updateBookPrimaryFile(book.id, winner?.id ?? null);
    await this.scannerRepo.markBooksAsPresent([book.id]);
    this.logger.log(
      `[scanner.file_event.restore_missing] [end] libraryId=${book.libraryId} bookId=${book.id} path="${sanitizeLogValue(winner?.absolutePath ?? existingContent[0].absolutePath)}" - missing book restored`,
    );
    return { type: 'book-restored', libraryId: book.libraryId, bookIds: [book.id] };
  }

  private async detectMovedFile(newAbsolutePath: string, fileStat: FsStat, scopeLibraryId?: number): Promise<FileEventResult> {
    const ino = Number(fileStat.ino);
    if (ino === 0) return { type: 'noop' };

    const match = await this.scannerRepo.findBookFileWithContextByIno(ino, scopeLibraryId);
    if (!match || match.file.absolutePath === newAbsolutePath) return { type: 'noop' };

    const { file, libraryId: rowLibraryId, folderPath: oldFolderPath, libraryFolderPath } = match;

    // Partial move guard - for multi-file books, verify the old file is
    // actually gone before reassigning. During a folder move, multiple events fire
    // and some files may not have been unlinked yet.
    const oldFileStillExists = await stat(file.absolutePath).then(
      (s) => s.isFile(),
      () => false,
    );
    if (oldFileStillExists) {
      this.logger.log(
        `[scanner.file_event.move] [end] libraryId=${rowLibraryId} bookId=${file.bookId} from="${sanitizeLogValue(file.absolutePath)}" to="${sanitizeLogValue(newAbsolutePath)}" action=skip_old_still_exists - old file still exists, deferring to scan`,
      );
      return { type: 'noop' };
    }

    const newFolderPath = dirname(newAbsolutePath) === libraryFolderPath ? newAbsolutePath : dirname(newAbsolutePath);
    if (newFolderPath !== oldFolderPath) {
      const targetBooks = await this.scannerRepo.findBooksByFolderPath(newFolderPath, rowLibraryId);
      const hasFolderCollision = targetBooks.some((book) => book.id !== file.bookId && book.folderPath === newFolderPath);
      if (hasFolderCollision) {
        this.logger.log(
          `[scanner.file_event.move] [end] libraryId=${rowLibraryId} bookId=${file.bookId} from="${sanitizeLogValue(file.absolutePath)}" to="${sanitizeLogValue(newAbsolutePath)}" action=defer_to_scan collisionFolder="${sanitizeLogValue(newFolderPath)}" - moved file deferred to folder scan`,
        );
        return { type: 'noop' };
      }
    }

    await this.scannerRepo.updateBookFile(file.id, {
      absolutePath: newAbsolutePath,
      relPath: relative(libraryFolderPath, newAbsolutePath),
      ...this.statToFileInfo(fileStat),
    });

    if (newFolderPath !== oldFolderPath) {
      await this.scannerRepo.updateBookFolderPath(file.bookId, newFolderPath);
    }

    await this.scannerRepo.markBooksAsPresent([file.bookId]);
    this.logger.log(
      `[scanner.file_event.move] [end] libraryId=${rowLibraryId} bookId=${file.bookId} from="${sanitizeLogValue(file.absolutePath)}" to="${sanitizeLogValue(newAbsolutePath)}" - moved file detected`,
    );
    return { type: 'book-moved', libraryId: rowLibraryId, bookIds: [file.bookId] };
  }

  private statToFileInfo(s: FsStat): { ino: number; sizeBytes: number; mtime: Date } {
    return { ino: Number(s.ino), sizeBytes: Number(s.size), mtime: s.mtime };
  }

  private async detectMovedBooksInDir(dirPath: string, scopeLibraryId?: number): Promise<FileEventResult> {
    const entries = await readdir(dirPath, { recursive: true, withFileTypes: true }).catch(() => []);
    const movedBookIds: number[] = [];
    let detectedLibraryId: number | null = null;

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const fullPath = join(entry.parentPath ?? dirPath, entry.name);
      const { role } = classifyFile(fullPath);
      if (role !== 'content') continue;

      const s = await stat(fullPath).catch(() => null);
      if (!s) continue;

      const result = await this.detectMovedFile(fullPath, s, scopeLibraryId);
      if (result.type === 'book-moved') {
        movedBookIds.push(...result.bookIds);
        detectedLibraryId = result.libraryId;
      }
    }

    if (movedBookIds.length === 0 || !detectedLibraryId) return { type: 'noop' };
    this.logger.log(
      `[scanner.file_event.move_dir] [end] libraryId=${detectedLibraryId} dirPath="${sanitizeLogValue(dirPath)}" movedCount=${movedBookIds.length} - moved books detected in directory`,
    );
    return { type: 'book-moved', libraryId: detectedLibraryId, bookIds: movedBookIds };
  }

  private pickPrimaryFile<T extends { id: number; format: string | null; sizeBytes: number | null }>(files: T[], formatPriority: string[]): T | null {
    if (files.length === 0) return null;
    const candidates = files.filter((f) => (f.sizeBytes ?? 0) > 0);
    const pool = candidates.length > 0 ? candidates : files;
    return formatPriority.reduce<T | null>((found, fmt) => found ?? pool.find((f) => f.format === fmt) ?? null, null) ?? pool[0] ?? null;
  }

  private async refreshPrimaryFile(bookId: number, libraryId: number): Promise<void> {
    const files = (await this.scannerRepo.findBookFilesByBookId(bookId))
      .filter((f) => f.role === 'content')
      .map((f) => ({ id: f.id, format: f.format, sizeBytes: f.sizeBytes }));
    const settings = await this.scannerRepo.findLibrarySettings(libraryId);
    const formatPriority = settings?.formatPriority ?? DEFAULT_FORMAT_PRIORITY;
    const winner = this.pickPrimaryFile(files, formatPriority);
    await this.scannerRepo.updateBookPrimaryFile(bookId, winner?.id ?? null);
  }

  private async handleCreateDir(absolutePath: string, scopeLibraryId?: number): Promise<FileEventResult> {
    const missingBooks = await this.scannerRepo.findMissingBooksByFolderPath(absolutePath, scopeLibraryId);
    if (missingBooks.length > 0) {
      const restoredIds: number[] = [];
      const matchedLibraryId = missingBooks[0].libraryId;

      for (const book of missingBooks) {
        const result = await this.tryRestoreBook(book as { id: number; libraryId: number; libraryFolderId: number; folderPath: string });
        if (result.type !== 'noop') restoredIds.push(book.id);
      }

      if (restoredIds.length > 0) {
        this.logger.log(
          `[scanner.file_event.create_dir] [end] libraryId=${matchedLibraryId} path="${sanitizeLogValue(absolutePath)}" restoredCount=${restoredIds.length} - books restored for returned folder`,
        );
        return { type: 'book-restored', libraryId: matchedLibraryId, bookIds: restoredIds };
      }
    }

    return this.detectMovedBooksInDir(absolutePath, scopeLibraryId);
  }
}
