import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResolvesMergedBook } from '../../common/decorators/resolves-merged-book.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { BookmarkService } from './bookmark.service';
import { CreateBookmarkDto } from './dto/create-bookmark.dto';
import { UpdateBookmarkDto } from './dto/update-bookmark.dto';
import { BookmarkQueryDto } from './dto/bookmark-query.dto';

@Controller('books/:bookId/bookmarks')
export class BookmarkController {
  constructor(private readonly bookmarkService: BookmarkService) {}

  @ResolvesMergedBook({ params: ['bookId'] })
  @Get()
  getBookmarks(@Param('bookId', ParseIntPipe) bookId: number, @CurrentUser() user: RequestUser, @Query() query: BookmarkQueryDto = {}) {
    return query.readerFileId == null
      ? this.bookmarkService.getBookmarks(bookId, user)
      : this.bookmarkService.getBookmarks(bookId, user, query.readerFileId);
  }

  @ResolvesMergedBook({ params: ['bookId'] })
  @Post()
  createBookmark(@Param('bookId', ParseIntPipe) bookId: number, @Body() dto: CreateBookmarkDto, @CurrentUser() user: RequestUser) {
    return this.bookmarkService.createBookmark(bookId, user, dto);
  }

  @ResolvesMergedBook({ params: ['bookId'] })
  @Patch(':bookmarkId')
  updateBookmark(
    @Param('bookId', ParseIntPipe) bookId: number,
    @Param('bookmarkId', ParseIntPipe) bookmarkId: number,
    @Body() dto: UpdateBookmarkDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.bookmarkService.updateBookmark(bookId, bookmarkId, user, dto);
  }

  @ResolvesMergedBook({ params: ['bookId'] })
  @Delete(':bookmarkId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteBookmark(
    @Param('bookId', ParseIntPipe) bookId: number,
    @Param('bookmarkId', ParseIntPipe) bookmarkId: number,
    @CurrentUser() user: RequestUser,
  ) {
    await this.bookmarkService.deleteBookmark(bookId, bookmarkId, user);
  }
}
