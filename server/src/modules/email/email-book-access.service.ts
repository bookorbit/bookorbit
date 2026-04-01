import { Injectable, NotFoundException } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { BookReadService } from '../book/book-read.service';
import { LibraryService } from '../library/library.service';

@Injectable()
export class EmailBookAccessService {
  constructor(
    private readonly bookReadService: BookReadService,
    private readonly libraryService: LibraryService,
  ) {}

  async assertUserCanAccessBook(bookId: number, user: RequestUser): Promise<void> {
    await this.assertUserCanAccessBooks([bookId], user);
  }

  async assertUserCanAccessBooks(bookIds: number[], user: RequestUser): Promise<void> {
    const uniqueBookIds = [...new Set(bookIds)];
    if (uniqueBookIds.length === 0) return;

    const rows = await this.bookReadService.findLibraryIdsByBookIds(uniqueBookIds);
    const libraryByBookId = new Map(rows.map((row) => [row.id, row.libraryId]));
    const missingBookId = uniqueBookIds.find((bookId) => !libraryByBookId.has(bookId));
    if (missingBookId !== undefined) {
      throw new NotFoundException(`Book ${missingBookId} not found`);
    }

    await Promise.all(
      uniqueBookIds.map(async (bookId) => {
        const libraryId = libraryByBookId.get(bookId);
        if (libraryId === undefined) throw new NotFoundException(`Book ${bookId} not found`);
        await this.libraryService.verifyUserAccess(user.id, libraryId, user.isSuperuser);
      }),
    );
  }
}
