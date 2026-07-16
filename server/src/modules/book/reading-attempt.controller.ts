import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { ReadingAttemptService } from '../user-book-status/reading-attempt.service';
import {
  CreateReadingAttemptDto,
  ListReadingAttemptsDto,
  StartRereadDto,
  UpdateReadingAttemptDto,
} from '../user-book-status/dto/reading-attempt.dto';
import { BookService } from './book.service';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '@bookorbit/types';

@Controller('books/:bookId/reading-attempts')
export class ReadingAttemptController {
  constructor(
    private readonly attempts: ReadingAttemptService,
    private readonly books: BookService,
  ) {}

  @Get()
  async list(@Param('bookId', ParseIntPipe) bookId: number, @Query() query: ListReadingAttemptsDto, @CurrentUser() user: RequestUser) {
    await this.books.verifyBookAccess(bookId, user);
    return this.attempts.list(user.id, bookId, query.page, query.pageSize);
  }

  @Post()
  async create(@Param('bookId', ParseIntPipe) bookId: number, @Body() dto: CreateReadingAttemptDto, @CurrentUser() user: RequestUser) {
    await this.books.verifyBookAccess(bookId, user);
    return this.attempts.createHistorical(user.id, bookId, dto);
  }

  @Post('start-reread')
  @RequirePermission(Permission.LibraryEditMetadata)
  async startReread(@Param('bookId', ParseIntPipe) bookId: number, @Body() dto: StartRereadDto, @CurrentUser() user: RequestUser) {
    await this.books.verifyBookAccess(bookId, user);
    if (dto.resetProgress !== false) await this.books.clearBookProgressForReread(user.id, bookId, user);
    return this.books.setReadStatus(bookId, { status: 'rereading' }, user);
  }

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

  @Delete(':attemptId')
  @RequirePermission(Permission.LibraryEditMetadata)
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('bookId', ParseIntPipe) bookId: number, @Param('attemptId', ParseIntPipe) attemptId: number, @CurrentUser() user: RequestUser) {
    await this.books.verifyBookAccess(bookId, user);
    await this.attempts.delete(user.id, bookId, attemptId);
  }
}
