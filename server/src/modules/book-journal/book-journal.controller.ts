import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';

import type { BookJournalEntry } from '@bookorbit/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { BookJournalService } from './book-journal.service';
import { BookJournalQueryDto } from './dto/book-journal-query.dto';
import { CreateBookJournalEntryDto } from './dto/create-book-journal-entry.dto';
import { UpdateBookJournalEntryDto } from './dto/update-book-journal-entry.dto';

@Controller('books/:bookId/journal')
export class BookJournalController {
  constructor(private readonly journalService: BookJournalService) {}

  @Get()
  list(
    @Param('bookId', ParseIntPipe) bookId: number,
    @CurrentUser() user: RequestUser,
    @Query() query: BookJournalQueryDto,
  ): Promise<BookJournalEntry[]> {
    return this.journalService.list(bookId, user, query.status ?? 'active');
  }

  /** Always 201, including an idempotent replay of a client id this book already holds. */
  @Post()
  create(
    @Param('bookId', ParseIntPipe) bookId: number,
    @Body() dto: CreateBookJournalEntryDto,
    @CurrentUser() user: RequestUser,
  ): Promise<BookJournalEntry> {
    return this.journalService.create(bookId, user, dto);
  }

  @Patch(':clientId')
  update(
    @Param('bookId', ParseIntPipe) bookId: number,
    @Param('clientId', new ParseUUIDPipe()) clientId: string,
    @Body() dto: UpdateBookJournalEntryDto,
    @CurrentUser() user: RequestUser,
  ): Promise<BookJournalEntry> {
    return this.journalService.update(bookId, clientId, user, dto);
  }

  @Delete(':clientId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async trash(
    @Param('bookId', ParseIntPipe) bookId: number,
    @Param('clientId', new ParseUUIDPipe()) clientId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    await this.journalService.trash(bookId, clientId, user);
  }

  @Post(':clientId/restore')
  @HttpCode(HttpStatus.OK)
  restore(
    @Param('bookId', ParseIntPipe) bookId: number,
    @Param('clientId', new ParseUUIDPipe()) clientId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<BookJournalEntry> {
    return this.journalService.restore(bookId, clientId, user);
  }

  @Delete(':clientId/permanent')
  @HttpCode(HttpStatus.NO_CONTENT)
  async purge(
    @Param('bookId', ParseIntPipe) bookId: number,
    @Param('clientId', new ParseUUIDPipe()) clientId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    await this.journalService.purge(bookId, clientId, user);
  }
}
