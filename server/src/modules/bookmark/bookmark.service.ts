import { Injectable, NotFoundException } from '@nestjs/common';

import { BookmarkRepository } from './bookmark.repository';
import { CreateBookmarkDto } from './dto/create-bookmark.dto';

@Injectable()
export class BookmarkService {
  constructor(private readonly bookmarkRepo: BookmarkRepository) {}

  async getBookmarks(bookId: number) {
    return this.bookmarkRepo.findByBookId(bookId);
  }

  async createBookmark(bookId: number, dto: CreateBookmarkDto) {
    return this.bookmarkRepo.create(bookId, dto.cfi, dto.title);
  }

  async deleteBookmark(bookId: number, bookmarkId: number) {
    const deleted = await this.bookmarkRepo.delete(bookId, bookmarkId);
    if (!deleted) throw new NotFoundException(`Bookmark ${bookmarkId} not found for book ${bookId}`);
  }
}
