import { Injectable, NotFoundException } from '@nestjs/common';

import { BookmarkRepository } from './bookmark.repository';
import { CreateBookmarkDto } from './dto/create-bookmark.dto';

@Injectable()
export class BookmarkService {
  constructor(private readonly bookmarkRepo: BookmarkRepository) {}

  async getBookmarks(bookId: number, userId: number) {
    return this.bookmarkRepo.findByBookId(bookId, userId);
  }

  async createBookmark(userId: number, bookId: number, dto: CreateBookmarkDto) {
    return this.bookmarkRepo.create(userId, bookId, dto.cfi, dto.title);
  }

  async deleteBookmark(bookId: number, bookmarkId: number, userId: number) {
    const deleted = await this.bookmarkRepo.delete(bookId, bookmarkId, userId);
    if (!deleted) throw new NotFoundException(`Bookmark ${bookmarkId} not found for book ${bookId}`);
  }
}
