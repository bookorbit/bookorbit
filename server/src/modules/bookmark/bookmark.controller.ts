import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post } from '@nestjs/common';

import { BookmarkService } from './bookmark.service';
import { CreateBookmarkDto } from './dto/create-bookmark.dto';

@Controller('books/:bookId/bookmarks')
export class BookmarkController {
  constructor(private readonly bookmarkService: BookmarkService) {}

  @Get()
  getBookmarks(@Param('bookId', ParseIntPipe) bookId: number) {
    return this.bookmarkService.getBookmarks(bookId);
  }

  @Post()
  createBookmark(@Param('bookId', ParseIntPipe) bookId: number, @Body() dto: CreateBookmarkDto) {
    // TODO: replace with real userId from auth guard once auth is wired up
    return this.bookmarkService.createBookmark(1, bookId, dto);
  }

  @Delete(':bookmarkId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteBookmark(@Param('bookId', ParseIntPipe) bookId: number, @Param('bookmarkId', ParseIntPipe) bookmarkId: number) {
    await this.bookmarkService.deleteBookmark(bookId, bookmarkId);
  }
}
