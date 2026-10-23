import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import type { NewBookmark } from '../../db/schema';
import { BookService } from '../book/book.service';
import { PositionConverterService } from '../position-converter/position-converter.service';
import { BookmarkRepository } from './bookmark.repository';
import { BookmarkResponseDto } from './dto/bookmark-response.dto';
import { CreateBookmarkDto } from './dto/create-bookmark.dto';
import { UpdateBookmarkDto } from './dto/update-bookmark.dto';

const BOOKMARK_CONFLICT_MESSAGE = 'Bookmark already exists';

@Injectable()
export class BookmarkService {
  constructor(
    private readonly bookmarkRepo: BookmarkRepository,
    private readonly bookService: BookService,
    private readonly positionConverter: PositionConverterService,
  ) {}

  async getBookmarks(bookId: number, user: RequestUser, readerFileId?: number): Promise<BookmarkResponseDto[]> {
    await this.bookService.verifyBookAccess(bookId, user);
    if (readerFileId != null) await this.verifyFile(bookId, readerFileId, user);
    const rows = await this.bookmarkRepo.findByBookId(bookId, user.id);
    if (readerFileId != null) {
      const projected: BookmarkResponseDto[] = [];
      for (const row of rows) {
        const dto = BookmarkResponseDto.from(row);
        if (row.bookFileId == null || !row.cfi) {
          dto.cfi = null;
        } else if (row.bookFileId !== readerFileId) {
          const target = await this.positionConverter.cfiPointToXpointer({
            bookFileId: readerFileId,
            cfi: row.cfi,
            sourceBookFileId: row.bookFileId,
          });
          const cfi = target.pos0 ? await this.positionConverter.xpointerPointToCfi({ bookFileId: readerFileId, pos: target.pos0 }) : null;
          dto.cfi = cfi?.cfi ?? null;
        }
        projected.push(dto);
      }
      return projected;
    }
    return rows.map((row) => BookmarkResponseDto.from(row));
  }

  async createBookmark(bookId: number, user: RequestUser, dto: CreateBookmarkDto): Promise<BookmarkResponseDto> {
    await this.bookService.verifyBookAccess(bookId, user);
    if (dto.bookFileId != null) await this.verifyFile(bookId, dto.bookFileId, user);
    const createData = this.buildCreateData(dto);
    // Released iOS builds send a CFI without its file, and device sync cannot place a bookmark it
    // cannot tie to a file.
    if (createData.bookFileId == null && createData.cfi) {
      createData.bookFileId = await this.bookmarkRepo.findLikelySourceFileId(user.id, bookId);
    }
    const location = { cfi: createData.cfi, positionSeconds: createData.positionSeconds };

    const existing = await this.bookmarkRepo.findLiveByLocation(user.id, bookId, location);
    if (existing) {
      if (existing.bookFileId == null && createData.bookFileId != null) {
        await this.bookmarkRepo.captureSourceFile(user.id, existing.id, dto.cfi, createData.bookFileId);
      }
      return BookmarkResponseDto.from(existing);
    }

    const row = await this.bookmarkRepo.create(user.id, bookId, createData);
    if (row) return BookmarkResponseDto.from(row);

    // The insert conflicted: either a tombstone still owns this location and has to
    // come back to life, or another request created the same bookmark first.
    const restored = await this.bookmarkRepo.restoreAtLocation(user.id, bookId, location, {
      title: createData.title,
      origin: 'web',
      devicePos: null,
      pageno: null,
      bookFileId: createData.bookFileId,
    });
    if (restored) return BookmarkResponseDto.from(restored);

    const concurrent = await this.bookmarkRepo.findLiveByLocation(user.id, bookId, location);
    if (concurrent) return BookmarkResponseDto.from(concurrent);
    throw new ConflictException(BOOKMARK_CONFLICT_MESSAGE);
  }

  /**
   * Renames a bookmark or edits its note. The new updated_at makes the next KOReader exchange and Kobo
   * sync push the change to devices that already hold the dogear.
   */
  async updateBookmark(bookId: number, bookmarkId: number, user: RequestUser, dto: UpdateBookmarkDto): Promise<BookmarkResponseDto> {
    await this.bookService.verifyBookAccess(bookId, user);
    const patch = {
      ...(dto.title !== undefined && { title: dto.title }),
      ...(dto.note !== undefined && { note: dto.note }),
    };
    const row =
      Object.keys(patch).length === 0
        ? await this.bookmarkRepo.findLive(bookId, bookmarkId, user.id)
        : await this.bookmarkRepo.update(bookId, bookmarkId, user.id, patch);
    if (!row) throw new NotFoundException(this.notFoundMessage(bookId, bookmarkId));
    return BookmarkResponseDto.from(row);
  }

  async deleteBookmark(bookId: number, bookmarkId: number, user: RequestUser): Promise<void> {
    await this.bookService.verifyBookAccess(bookId, user);
    const deleted = await this.bookmarkRepo.softDelete(bookId, bookmarkId, user.id);
    if (!deleted) throw new NotFoundException(this.notFoundMessage(bookId, bookmarkId));
  }

  private buildCreateData(dto: CreateBookmarkDto): Pick<NewBookmark, 'cfi' | 'title' | 'positionSeconds' | 'bookFileId'> {
    return {
      cfi: dto.cfi,
      title: dto.title,
      positionSeconds: null,
      bookFileId: dto.bookFileId ?? null,
    };
  }

  private async verifyFile(bookId: number, bookFileId: number, user: RequestUser): Promise<void> {
    const file = await this.bookService.verifyFileAccess(bookFileId, user);
    if (file.bookId !== bookId) throw new BadRequestException('The selected file does not belong to this book');
  }

  private notFoundMessage(bookId: number, bookmarkId: number): string {
    return `Bookmark ${bookmarkId} not found for book ${bookId}`;
  }
}
