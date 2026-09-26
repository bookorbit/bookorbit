import { Injectable, NotFoundException } from '@nestjs/common';
import { isAudioFormat, isContentBookFile } from '@bookorbit/types';

import type { BookFile } from '../../db/schema';
import { rankFilesByFormatPriority } from '../../common/utils/primary-file-selection.utils';
import { EmailBookReadRepository } from './email-book-read.repository';

/** A file an email can carry: a readable edition, never a cover, sidecar or audiobook track. */
function isSendable(file: BookFile): boolean {
  return isContentBookFile(file) && !isAudioFormat(file.format!);
}

@Injectable()
export class EmailFileSelector {
  constructor(private readonly bookReadRepository: EmailBookReadRepository) {}

  async select(bookId: number, fileId: number | null | undefined, preferredFormat: string | null | undefined): Promise<BookFile> {
    if (fileId !== null && fileId !== undefined) {
      const file = await this.bookReadRepository.findFileForBook(bookId, fileId);
      if (!file || !isSendable(file)) throw new NotFoundException('Book file not found');
      return file;
    }

    const allFiles = await this.bookReadRepository.findFilesByBookId(bookId);
    if (allFiles.length === 0) throw new NotFoundException('No files found for this book');

    const [primaryFileId, formatPriority] = await Promise.all([
      this.bookReadRepository.findBookPrimaryFileId(bookId),
      this.bookReadRepository.findLibraryFormatPriority(bookId),
    ]);
    const sendable = rankFilesByFormatPriority(allFiles.filter(isSendable), formatPriority, primaryFileId);
    if (sendable.length === 0) throw new NotFoundException('This book has no file that can be sent by email');

    if (preferredFormat) {
      const wanted = preferredFormat.toLowerCase();
      const matches = sendable.filter((file) => file.format?.toLowerCase() === wanted);
      // An e-reader gets the plain EPUB when a book has one beside its read-along copy.
      const match = matches.find((file) => !file.mediaOverlayAvailable) ?? matches[0];
      if (match) return match;
    }

    return sendable[0];
  }
}
