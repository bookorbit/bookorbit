import { Injectable, Logger } from '@nestjs/common';
import { readdir, stat } from 'fs/promises';
import { dirname, join, relative } from 'path';

import { classifyFile } from './lib/classify';
import { ScannerRepository } from './scanner.repository';

export type FileEventResult =
  | { type: 'book-missing'; libraryId: number; bookIds: number[] }
  | { type: 'book-restored'; libraryId: number; bookIds: number[] }
  | { type: 'book-moved'; libraryId: number; bookIds: number[] }
  | { type: 'noop' };

@Injectable()
export class FileEventProcessorService {
  private readonly logger = new Logger(FileEventProcessorService.name);

  constructor(private readonly scannerRepo: ScannerRepository) {}

  async handleUnlink(absolutePath: string): Promise<FileEventResult> {
    const row = await this.scannerRepo.findBookFileByAbsolutePath(absolutePath);
    if (!row) return { type: 'noop' };

    const { file, libraryId } = row;
    await this.scannerRepo.markBooksAsMissing([file.bookId]);
    this.logger.log(`Book ${file.bookId} marked missing — file removed: ${absolutePath}`);
    return { type: 'book-missing', libraryId, bookIds: [file.bookId] };
  }

  async handleUnlinkDir(absolutePath: string): Promise<FileEventResult> {
    const matched = await this.scannerRepo.findBooksByFolderPath(absolutePath);
    if (matched.length === 0) return { type: 'noop' };

    const bookIds = matched.map((b) => b.id);
    const libraryId = matched[0].libraryId;

    await this.scannerRepo.markBooksAsMissing(bookIds);

    this.logger.log(`${bookIds.length} book(s) marked missing — folder removed: ${absolutePath}`);
    return { type: 'book-missing', libraryId, bookIds };
  }

  async handleCreate(absolutePath: string): Promise<FileEventResult> {
    const fileStat = await stat(absolutePath).catch(() => null);
    if (!fileStat) return { type: 'noop' };

    if (fileStat.isDirectory()) return this.handleCreateDir(absolutePath);

    const { role, format } = classifyFile(absolutePath);
    if (role !== 'primary') return { type: 'noop' };

    const existing = await this.scannerRepo.findBookFileByAbsolutePath(absolutePath);
    if (existing) {
      const book =
        (await this.scannerRepo.findMissingBookByFolderPath(dirname(absolutePath))) ??
        (await this.scannerRepo.findMissingBookByFolderPath(absolutePath));
      if (!book) return { type: 'noop' };

      await this.scannerRepo.updateBookFile(existing.file.id, this.statToFileInfo(fileStat));
      await this.scannerRepo.markBooksAsPresent([book.id]);
      this.logger.log(`Book ${book.id} restored — file returned: ${absolutePath}`);
      return { type: 'book-restored', libraryId: book.libraryId, bookIds: [book.id] };
    }

    const folderPath = dirname(absolutePath);
    const book =
      (await this.scannerRepo.findMissingBookByFolderPath(folderPath)) ?? (await this.scannerRepo.findMissingBookByFolderPath(absolutePath));
    if (book) {
      const libraryFolderPath = await this.scannerRepo.findLibraryFolderPath(book.libraryFolderId);
      await this.scannerRepo.createBookFile({
        bookId: book.id,
        libraryFolderId: book.libraryFolderId,
        absolutePath,
        relPath: libraryFolderPath ? relative(libraryFolderPath, absolutePath) : undefined,
        ...this.statToFileInfo(fileStat),
        format,
        role: 'primary',
      });

      await this.scannerRepo.markBooksAsPresent([book.id]);
      this.logger.log(`Book ${book.id} restored — file returned: ${absolutePath}`);
      return { type: 'book-restored', libraryId: book.libraryId, bookIds: [book.id] };
    }

    return this.detectMovedFile(absolutePath, fileStat);
  }

  async reconcileMissingBooks(libraryIds: number[]): Promise<FileEventResult[]> {
    const missing = await this.scannerRepo.findMissingBooksForLibraries(libraryIds);
    if (missing.length === 0) return [];

    const results: FileEventResult[] = [];

    for (const book of missing) {
      const result = await this.tryRestoreBook(book);
      if (result.type !== 'noop') results.push(result);
    }

    return results;
  }

  private async tryRestoreBook(book: { id: number; libraryId: number; libraryFolderId: number; folderPath: string }): Promise<FileEventResult> {
    const files = await this.scannerRepo.findPrimaryBookFilesByBookId(book.id);

    for (const file of files) {
      const s = await stat(file.absolutePath).catch(() => null);
      if (!s || !s.isFile()) continue;

      await this.scannerRepo.updateBookFile(file.id, this.statToFileInfo(s));
      await this.scannerRepo.markBooksAsPresent([book.id]);
      this.logger.log(`Book ${book.id} restored — file returned: ${file.absolutePath}`);
      return { type: 'book-restored', libraryId: book.libraryId, bookIds: [book.id] };
    }

    return { type: 'noop' };
  }

  private async detectMovedFile(newAbsolutePath: string, fileStat: Awaited<ReturnType<typeof stat>>): Promise<FileEventResult> {
    const match = await this.scannerRepo.findBookFileWithContextByIno(Number(fileStat.ino));
    if (!match || match.file.absolutePath === newAbsolutePath) return { type: 'noop' };

    const { file, libraryId, folderPath: oldFolderPath, libraryFolderPath } = match;
    const newFolderPath = oldFolderPath === file.absolutePath ? newAbsolutePath : dirname(newAbsolutePath);

    await this.scannerRepo.updateBookFile(file.id, {
      absolutePath: newAbsolutePath,
      relPath: relative(libraryFolderPath, newAbsolutePath),
      ...this.statToFileInfo(fileStat),
    });

    if (newFolderPath !== oldFolderPath) {
      await this.scannerRepo.updateBookFolderPath(file.bookId, newFolderPath);
    }

    await this.scannerRepo.markBooksAsPresent([file.bookId]);
    this.logger.log(`Book ${file.bookId} moved: ${file.absolutePath} → ${newAbsolutePath}`);
    return { type: 'book-moved', libraryId, bookIds: [file.bookId] };
  }

  private statToFileInfo(s: Awaited<ReturnType<typeof stat>>): { ino: number; sizeBytes: number; mtime: Date } {
    return { ino: Number(s.ino), sizeBytes: Number(s.size), mtime: s.mtime };
  }

  private async detectMovedBooksInDir(dirPath: string): Promise<FileEventResult> {
    const entries = await readdir(dirPath, { recursive: true, withFileTypes: true }).catch(() => []);
    const movedBookIds: number[] = [];
    let libraryId: number | null = null;

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const fullPath = join(entry.parentPath ?? dirPath, entry.name);
      const { role } = classifyFile(fullPath);
      if (role !== 'primary') continue;

      const s = await stat(fullPath).catch(() => null);
      if (!s) continue;

      const result = await this.detectMovedFile(fullPath, s);
      if (result.type === 'book-moved') {
        movedBookIds.push(...result.bookIds);
        libraryId = result.libraryId;
      }
    }

    if (movedBookIds.length === 0 || !libraryId) return { type: 'noop' };
    this.logger.log(`${movedBookIds.length} book(s) moved: folder appeared: ${dirPath}`);
    return { type: 'book-moved', libraryId, bookIds: movedBookIds };
  }

  private async handleCreateDir(absolutePath: string): Promise<FileEventResult> {
    const missingBooks = await this.scannerRepo.findMissingBooksByFolderPath(absolutePath);
    if (missingBooks.length > 0) {
      const restoredIds: number[] = [];
      const libraryId = missingBooks[0].libraryId;

      for (const book of missingBooks) {
        const result = await this.tryRestoreBook(book);
        if (result.type !== 'noop') restoredIds.push(book.id);
      }

      if (restoredIds.length > 0) {
        this.logger.log(`${restoredIds.length} book(s) restored: folder returned: ${absolutePath}`);
        return { type: 'book-restored', libraryId, bookIds: restoredIds };
      }
    }

    return this.detectMovedBooksInDir(absolutePath);
  }
}
