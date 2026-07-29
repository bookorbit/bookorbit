import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import type { NewBookmark } from '../../db/schema';
import { BookService } from '../book/book.service';
import { BookmarkRepository } from './bookmark.repository';
import { BookmarkResponseDto } from './dto/bookmark-response.dto';
import { CreateBookmarkDto } from './dto/create-bookmark.dto';

const BOOKMARK_CONFLICT_MESSAGE = 'Bookmark already exists';

@Injectable()
export class BookmarkService {
  constructor(
    private readonly bookmarkRepo: BookmarkRepository,
    private readonly bookService: BookService,
  ) {}

  async getBookmarks(bookId: number, user: RequestUser): Promise<BookmarkResponseDto[]> {
    await this.bookService.verifyBookAccess(bookId, user);
    const rows = await this.bookmarkRepo.findByBookId(bookId, user.id);
    return rows.map((row) => BookmarkResponseDto.from(row));
  }

  async createBookmark(bookId: number, user: RequestUser, dto: CreateBookmarkDto): Promise<BookmarkResponseDto> {
    await this.bookService.verifyBookAccess(bookId, user);
    const createData = this.buildCreateData(dto);
    const location = { cfi: createData.cfi, positionSeconds: createData.positionSeconds };

    const existing = await this.bookmarkRepo.findLiveByLocation(user.id, bookId, location);
    if (existing) return BookmarkResponseDto.from(existing);

    const row = await this.bookmarkRepo.create(user.id, bookId, createData);
    if (row) return BookmarkResponseDto.from(row);

    // The insert conflicted: either a tombstone still owns this location and has to
    // come back to life, or another request created the same bookmark first.
    const restored = await this.bookmarkRepo.restoreAtLocation(user.id, bookId, location, {
      title: createData.title,
      origin: 'web',
      devicePos: null,
      pageno: null,
    });
    if (restored) return BookmarkResponseDto.from(restored);

    const concurrent = await this.bookmarkRepo.findLiveByLocation(user.id, bookId, location);
    if (concurrent) return BookmarkResponseDto.from(concurrent);
    throw new ConflictException(BOOKMARK_CONFLICT_MESSAGE);
  }

  async deleteBookmark(bookId: number, bookmarkId: number, user: RequestUser): Promise<void> {
    await this.bookService.verifyBookAccess(bookId, user);
    const deleted = await this.bookmarkRepo.softDelete(bookId, bookmarkId, user.id);
    if (!deleted) throw new NotFoundException(this.notFoundMessage(bookId, bookmarkId));
  }

  private buildCreateData(dto: CreateBookmarkDto): Pick<NewBookmark, 'cfi' | 'title' | 'positionSeconds'> {
    return {
      cfi: dto.cfi ?? null,
      title: dto.title,
      positionSeconds: dto.positionSeconds ?? null,
    };
  }

  private notFoundMessage(bookId: number, bookmarkId: number): string {
    return `Bookmark ${bookmarkId} not found for book ${bookId}`;
  }
}
