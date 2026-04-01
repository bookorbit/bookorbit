import { Injectable, NotFoundException } from '@nestjs/common';

import type { BookFile } from '../../db/schema';
import { EmailBookReadRepository } from './email-book-read.repository';

@Injectable()
export class EmailFileSelector {
  constructor(private readonly bookReadRepository: EmailBookReadRepository) {}

  async select(bookId: number, fileId: number | null | undefined, preferredFormat: string | null | undefined): Promise<BookFile> {
    if (fileId !== null && fileId !== undefined) {
      const file = await this.bookReadRepository.findFileForBook(bookId, fileId);
      if (!file) throw new NotFoundException('Book file not found');
      return file;
    }

    const allFiles = await this.bookReadRepository.findFilesByBookId(bookId);
    if (allFiles.length === 0) throw new NotFoundException('No files found for this book');

    if (preferredFormat) {
      const match = allFiles.find((f) => f.format?.toLowerCase() === preferredFormat.toLowerCase());
      if (match) return match;
    }

    const primaryFileId = await this.bookReadRepository.findBookPrimaryFileId(bookId);
    const primary = allFiles.find((f) => f.id === primaryFileId);
    return primary ?? allFiles[0];
  }
}
