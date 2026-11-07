import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResolvesMergedBook } from '../../common/decorators/resolves-merged-book.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { CreateManualReadingSessionDto } from './dto/create-manual-reading-session.dto';
import { ListBookReadingSessionsDto } from './dto/list-book-reading-sessions.dto';
import { ReadingSessionService } from './reading-session.service';

@Controller('books')
export class BookReadingSessionController {
  constructor(private readonly service: ReadingSessionService) {}

  @ResolvesMergedBook({ params: ['bookId'] })
  @Get(':bookId/sessions')
  listSessions(@Param('bookId', ParseIntPipe) bookId: number, @Query() query: ListBookReadingSessionsDto, @CurrentUser() user: RequestUser) {
    return this.service.listByBook(bookId, user, query);
  }

  @ResolvesMergedBook({ params: ['bookId'] })
  @Post(':bookId/sessions')
  createSession(@Param('bookId', ParseIntPipe) bookId: number, @Body() dto: CreateManualReadingSessionDto, @CurrentUser() user: RequestUser) {
    return this.service.createManualSession(bookId, dto, user);
  }

  @ResolvesMergedBook({ params: ['bookId'] })
  @Delete(':bookId/sessions/:sessionId')
  @HttpCode(204)
  async deleteSession(
    @Param('bookId', ParseIntPipe) bookId: number,
    @Param('sessionId', ParseIntPipe) sessionId: number,
    @CurrentUser() user: RequestUser,
  ) {
    await this.service.deleteSessionByBook(bookId, sessionId, user);
  }
}
