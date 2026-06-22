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

  findPrimaryReaderFilesByBookIds(bookIds: number[]) {
    return this.bookRepo.findPrimaryReaderFilesByBookIds(bookIds);
  }

  findCards(opts: { where: SQL | undefined; orderBy: SQL[]; limit: number; offset: number; userId: number }) {
    return this.bookRepo.findCards(opts);
  }

  findCardsByBookIds(bookIds: number[], userId: number) {
    return this.bookRepo.findCardsByBookIds(bookIds, userId);
  }

  countWhere(where: SQL | undefined): Promise<number> {
    return this.bookRepo.countWhere(where);
  }

  findLibraryIdsByBookIds(bookIds: number[]) {
    return this.bookRepo.findLibraryIdsByBookIds(bookIds);
  }

  findRecommendationTitlesByBookIds(bookIds: number[]) {
    return this.bookRepo.findRecommendationTitlesByBookIds(bookIds);
  }

  findById(id: number) {
    return this.bookRepo.findById(id);
  }

  findProgressByBook(userId: number, bookId: number) {
    return this.bookRepo.findProgressByBook(userId, bookId);
  }

  findProgressByBooks(userId: number, bookIds: number[]) {
    return this.bookRepo.findProgressByBooks(userId, bookIds);
  }

  checkBookPassesContentFilters(bookId: number, contentFilters: import('@bookorbit/types').ContentFilterRules) {
    return this.bookRepo.checkBookPassesContentFilters(bookId, contentFilters);
  }

  updateMetadataFields(bookId: number, fields: Parameters<BookRepository['updateMetadataFields']>[1]) {
    return this.bookRepo.updateMetadataFields(bookId, fields);
  }

  replaceCommunityRatings(bookId: number, ratings: Parameters<BookRepository['replaceCommunityRatings']>[1]) {
    return this.bookRepo.replaceCommunityRatings(bookId, ratings);
  }
}
