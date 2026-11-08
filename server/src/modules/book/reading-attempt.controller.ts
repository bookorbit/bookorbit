import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResolvesMergedBook } from '../../common/decorators/resolves-merged-book.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { ReadingAttemptService } from '../user-book-status/reading-attempt.service';
import {
  CreateReadingAttemptDto,
  ListReadingAttemptsDto,
  StartRereadDto,
  UpdateReadingAttemptDto,
} from '../user-book-status/dto/reading-attempt.dto';
import { BookService } from './book.service';

@Controller('books/:bookId/reading-attempts')
export class ReadingAttemptController {
  constructor(
    private readonly attempts: ReadingAttemptService,
    private readonly books: BookService,
  ) {}

  @ResolvesMergedBook({ params: ['bookId'] })
  @Get()
  async list(@Param('bookId', ParseIntPipe) bookId: number, @Query() query: ListReadingAttemptsDto, @CurrentUser() user: RequestUser) {
    await this.books.verifyBookAccess(bookId, user);
    return this.attempts.list(user.id, bookId, query.page, query.pageSize);
  }

  @ResolvesMergedBook({ params: ['bookId'] })
  @Post()
  async create(@Param('bookId', ParseIntPipe) bookId: number, @Body() dto: CreateReadingAttemptDto, @CurrentUser() user: RequestUser) {
    await this.books.verifyBookAccess(bookId, user);
    return this.attempts.createHistorical(user.id, bookId, dto);
  }

  /**
   * Takes no permission beyond book access, like every other route here. All five are scoped by
   * `user.id`, so they touch nothing but the caller's own reading history; gating only this one and
   * the delete left the controller contradicting itself, since an attempt could be created and
   * edited without the permission but not started or removed.
   */
  @ResolvesMergedBook({ params: ['bookId'] })
  @Post('start-reread')
  async startReread(@Param('bookId', ParseIntPipe) bookId: number, @Body() dto: StartRereadDto, @CurrentUser() user: RequestUser) {
    await this.books.verifyBookAccess(bookId, user);
    if (dto.resetProgress !== false) await this.books.clearBookProgressForReread(user.id, bookId, user);
    return this.books.setReadStatus(bookId, { status: 'rereading' }, user);
  }

  @ResolvesMergedBook({ params: ['bookId'] })
  @Patch(':attemptId')
  async update(
    @Param('bookId', ParseIntPipe) bookId: number,
    @Param('attemptId', ParseIntPipe) attemptId: number,
    @Body() dto: UpdateReadingAttemptDto,
    @CurrentUser() user: RequestUser,
  ) {
    await this.books.verifyBookAccess(bookId, user);
    return this.attempts.update(user.id, bookId, attemptId, dto);
  }

  @ResolvesMergedBook({ params: ['bookId'] })
  @Delete(':attemptId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('bookId', ParseIntPipe) bookId: number, @Param('attemptId', ParseIntPipe) attemptId: number, @CurrentUser() user: RequestUser) {
    await this.books.verifyBookAccess(bookId, user);
    await this.attempts.delete(user.id, bookId, attemptId);
  }
}
