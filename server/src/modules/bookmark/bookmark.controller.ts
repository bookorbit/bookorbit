import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { BookmarkService } from './bookmark.service';
import { CreateBookmarkDto } from './dto/create-bookmark.dto';

@Controller('books/:bookId/bookmarks')
export class BookmarkController {
  constructor(private readonly bookmarkService: BookmarkService) {}

  @Get()
  getBookmarks(@Param('bookId', ParseIntPipe) bookId: number, @CurrentUser() user: RequestUser) {
    return this.bookmarkService.getBookmarks(bookId, user);
  }

  @Post()
  createBookmark(@Param('bookId', ParseIntPipe) bookId: number, @Body() dto: CreateBookmarkDto, @CurrentUser() user: RequestUser) {
    return this.bookmarkService.createBookmark(bookId, user, dto);
  }

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
