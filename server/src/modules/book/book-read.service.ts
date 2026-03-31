import { Injectable } from '@nestjs/common';
import { SQL } from 'drizzle-orm';

import { BookRepository } from './book.repository';

@Injectable()
export class BookReadService {
  constructor(private readonly bookRepo: BookRepository) {}

  findLibraryIdByBookId(bookId: number) {
    return this.bookRepo.findLibraryIdByBookId(bookId);
  }

  findFileById(fileId: number) {
    return this.bookRepo.findFileById(fileId);
  }

  findPrimaryFilesByBookIds(bookIds: number[]) {
    return this.bookRepo.findPrimaryFilesByBookIds(bookIds);
  }

  findCards(opts: { where: SQL | undefined; orderBy: SQL[]; limit: number; offset: number; userId: number }) {
    return this.bookRepo.findCards(opts);
  }

  countWhere(where: SQL | undefined): Promise<number> {
    return this.bookRepo.countWhere(where);
  }

  findRecommendationTitlesByBookIds(bookIds: number[]) {
    return this.bookRepo.findRecommendationTitlesByBookIds(bookIds);
  }

  findById(id: number) {
    return this.bookRepo.findById(id);
  }

  updateMetadataFields(bookId: number, fields: Parameters<BookRepository['updateMetadataFields']>[1]) {
    return this.bookRepo.updateMetadataFields(bookId, fields);
  }
}
