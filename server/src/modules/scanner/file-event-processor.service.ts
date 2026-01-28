import { Injectable, Logger } from '@nestjs/common';
import { stat } from 'fs/promises';
import { dirname } from 'path';

import { classifyFile } from './lib/classify';
import { ScannerRepository } from './scanner.repository';

export type FileEventResult =
  | { type: 'book-missing'; libraryId: number; bookIds: number[] }
  | { type: 'book-restored'; libraryId: number; bookIds: number[] }
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
    const libraryId = matched[0]!.libraryId;

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
      const book = await this.scannerRepo.findMissingBookByFolderPath(dirname(absolutePath)) ??
        await this.scannerRepo.findMissingBookByFolderPath(absolutePath);
      if (!book) return { type: 'noop' };

      await this.scannerRepo.updateBookFile(existing.file.id, {
        ino: BigInt(fileStat.ino),
        sizeBytes: BigInt(fileStat.size),
        mtime: fileStat.mtime,
      });
      await this.scannerRepo.markBooksAsPresent([book.id]);
      this.logger.log(`Book ${book.id} restored — file returned: ${absolutePath}`);
      return { type: 'book-restored', libraryId: book.libraryId, bookIds: [book.id] };
    }

    const folderPath = dirname(absolutePath);
    const book =
      (await this.scannerRepo.findMissingBookByFolderPath(folderPath)) ??
      (await this.scannerRepo.findMissingBookByFolderPath(absolutePath));
    if (!book) return { type: 'noop' };

    await this.scannerRepo.createBookFile({
      bookId: book.id,
      libraryFolderId: book.libraryFolderId,
      absolutePath,
      ino: BigInt(fileStat.ino),
      sizeBytes: BigInt(fileStat.size),
      mtime: fileStat.mtime,
      format,
      role: 'primary',
    });

    await this.scannerRepo.markBooksAsPresent([book.id]);
    this.logger.log(`Book ${book.id} restored — file returned: ${absolutePath}`);
    return { type: 'book-restored', libraryId: book.libraryId, bookIds: [book.id] };
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

  private async tryRestoreBook(book: {
    id: number;
    libraryId: number;
    libraryFolderId: number;
    folderPath: string;
  }): Promise<FileEventResult> {
    const files = await this.scannerRepo.findPrimaryBookFilesByBookId(book.id);

    for (const file of files) {
      const s = await stat(file.absolutePath).catch(() => null);
      if (!s || !s.isFile()) continue;

      await this.scannerRepo.updateBookFile(file.id, {
        ino: BigInt(s.ino),
        sizeBytes: BigInt(s.size),
        mtime: s.mtime,
      });
      await this.scannerRepo.markBooksAsPresent([book.id]);
      this.logger.log(`Book ${book.id} restored — file returned: ${file.absolutePath}`);
      return { type: 'book-restored', libraryId: book.libraryId, bookIds: [book.id] };
    }

    return { type: 'noop' };
  }

  private async handleCreateDir(absolutePath: string): Promise<FileEventResult> {
    const missingBooks = await this.scannerRepo.findMissingBooksByFolderPath(absolutePath);
    if (missingBooks.length === 0) return { type: 'noop' };

    const restoredIds: number[] = [];
    const libraryId = missingBooks[0]!.libraryId;

    for (const book of missingBooks) {
      const result = await this.tryRestoreBook(book);
      if (result.type !== 'noop') restoredIds.push(book.id);
    }

    if (restoredIds.length === 0) return { type: 'noop' };

    this.logger.log(`${restoredIds.length} book(s) restored: folder returned: ${absolutePath}`);
    return { type: 'book-restored', libraryId, bookIds: restoredIds };
  }
}
