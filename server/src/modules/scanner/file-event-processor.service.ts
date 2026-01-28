import { Injectable, Logger } from '@nestjs/common';

import { ScannerRepository } from './scanner.repository';

export type FileEventResult =
  | { type: 'book-missing'; libraryId: number; bookIds: number[] }
  | { type: 'file-removed'; libraryId: number; bookId: number; fileId: number }
  | { type: 'noop' };

@Injectable()
export class FileEventProcessorService {
  private readonly logger = new Logger(FileEventProcessorService.name);

  constructor(private readonly scannerRepo: ScannerRepository) {}

  async handleUnlink(absolutePath: string): Promise<FileEventResult> {
    const row = await this.scannerRepo.findBookFileByAbsolutePath(absolutePath);
    if (!row) return { type: 'noop' };

    const { file, libraryId } = row;
    await this.scannerRepo.deleteBookFile(file.id);

    const remaining = await this.scannerRepo.countBookFilesByBookId(file.bookId);
    if (remaining === 0) {
      await this.scannerRepo.markBooksAsMissing([file.bookId]);
      this.logger.log(`Book ${file.bookId} marked missing — last file removed: ${absolutePath}`);
      return { type: 'book-missing', libraryId, bookIds: [file.bookId] };
    }

    this.logger.log(`File ${file.id} removed from book ${file.bookId}: ${absolutePath}`);
    return { type: 'file-removed', libraryId, bookId: file.bookId, fileId: file.id };
  }

  async handleUnlinkDir(absolutePath: string): Promise<FileEventResult> {
    const matched = await this.scannerRepo.findBooksByFolderPath(absolutePath);
    if (matched.length === 0) return { type: 'noop' };

    const bookIds = matched.map((b) => b.id);
    const libraryId = matched[0]!.libraryId;

    await this.scannerRepo.deleteBookFilesByBookIds(bookIds);
    await this.scannerRepo.markBooksAsMissing(bookIds);

    this.logger.log(`${bookIds.length} book(s) marked missing — folder removed: ${absolutePath}`);
    return { type: 'book-missing', libraryId, bookIds };
  }
}
