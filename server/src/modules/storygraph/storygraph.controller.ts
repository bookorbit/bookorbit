import { Permission } from '@bookorbit/types';
import { Body, Controller, Delete, Get, MessageEvent, Param, ParseIntPipe, Patch, Post, Sse } from '@nestjs/common';
import { map, Observable } from 'rxjs';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { BookService } from '../book/book.service';
import {
  LinkStorygraphBookDto,
  SetStorygraphEditionDto,
  UpdateStorygraphBookSyncDto,
  UpsertStorygraphSettingsDto,
  ValidateStorygraphCookiesDto,
} from './dto';
import { StorygraphSettingsService } from './storygraph-settings.service';
import { StorygraphSyncService } from './storygraph-sync.service';

@Controller('storygraph')
@RequirePermission(Permission.StorygraphSync)
export class StorygraphController {
  constructor(
    private readonly settingsService: StorygraphSettingsService,
    private readonly syncService: StorygraphSyncService,
    private readonly bookService: BookService,
  ) {}

  @Get('settings')
  getSettings(@CurrentUser() user: RequestUser) {
    return this.settingsService.getSettings(user.id);
  }

  @Patch('settings')
  upsertSettings(@CurrentUser() user: RequestUser, @Body() dto: UpsertStorygraphSettingsDto) {
    return this.settingsService.upsertSettings(user.id, dto);
  }

  @Delete('settings')
  disconnectUser(@CurrentUser() user: RequestUser) {
    return this.settingsService.disconnectUser(user.id);
  }

  @Post('validate-cookies')
  validateCookies(@CurrentUser() user: RequestUser, @Body() dto: ValidateStorygraphCookiesDto) {
    return this.settingsService.validateCookies(user.id, dto.sessionCookie, dto.rememberToken);
  }

  @Post('sync')
  startSync(@CurrentUser() user: RequestUser) {
    return this.syncService.syncAll(user).then((runId) => ({ runId }));
  }

  @Delete('sync')
  cancelSync(@CurrentUser() user: RequestUser) {
    return this.syncService.cancelSync(user.id);
  }

  @Get('sync/status')
  getSyncStatus(@CurrentUser() user: RequestUser) {
    return this.syncService.getSyncStatus(user.id);
  }

  @Sse('sync/stream')
  getSyncStatusStream(@CurrentUser() user: RequestUser): Observable<MessageEvent> {
    return this.syncService.streamSyncStatus(user.id).pipe(map((status) => ({ data: { activeSyncStatus: status } })));
  }

  @Get('sync/pending')
  getSyncPendingSummary(@CurrentUser() user: RequestUser) {
    return this.syncService.getSyncPendingSummary(user);
  }

  @Get('sync/failures')
  listSyncFailures(@CurrentUser() user: RequestUser) {
    return this.syncService.listSyncFailures(user);
  }

  @Post('books/:bookId/rematch')
  async rematchBook(@CurrentUser() user: RequestUser, @Param('bookId', ParseIntPipe) bookId: number) {
    await this.bookService.verifyBookAccess(bookId, user);
    return this.syncService.rematchBook(user.id, bookId).then((result) => ({ result }));
  }

  @Get('books')
  listLinkedBooks(@CurrentUser() user: RequestUser) {
    return this.syncService.listLinkedBooks(user);
  }

  @Patch('books/:bookId/link')
  async linkBookManually(@CurrentUser() user: RequestUser, @Param('bookId', ParseIntPipe) bookId: number, @Body() dto: LinkStorygraphBookDto) {
    await this.bookService.verifyBookAccess(bookId, user);
    return this.syncService.linkBookManually(user.id, bookId, dto.input);
  }

  @Get('books/:bookId/editions')
  async listEditions(@CurrentUser() user: RequestUser, @Param('bookId', ParseIntPipe) bookId: number) {
    await this.bookService.verifyBookAccess(bookId, user);
    return this.syncService.listEditions(user.id, bookId);
  }

  @Patch('books/:bookId/edition')
  async setEdition(@CurrentUser() user: RequestUser, @Param('bookId', ParseIntPipe) bookId: number, @Body() dto: SetStorygraphEditionDto) {
    await this.bookService.verifyBookAccess(bookId, user);
    return this.syncService.setEdition(user.id, bookId, dto.editionId);
  }

  @Get('books/:bookId/sync-state')
  async getBookSyncState(@CurrentUser() user: RequestUser, @Param('bookId', ParseIntPipe) bookId: number) {
    await this.bookService.verifyBookAccess(bookId, user);
    return this.syncService.getBookSyncState(user.id, bookId);
  }

  @Patch('books/:bookId/sync-state')
  async updateBookSyncState(
    @CurrentUser() user: RequestUser,
    @Param('bookId', ParseIntPipe) bookId: number,
    @Body() dto: UpdateStorygraphBookSyncDto,
  ) {
    await this.bookService.verifyBookAccess(bookId, user);
    return this.syncService.updateBookSyncState(user.id, bookId, dto);
  }

  @Post('books/:bookId/sync')
  async syncBook(@CurrentUser() user: RequestUser, @Param('bookId', ParseIntPipe) bookId: number) {
    await this.bookService.verifyBookAccess(bookId, user);
    const result = await this.syncService.syncBook(user.id, bookId);
    const state = await this.syncService.getBookSyncState(user.id, bookId);
    return { result, state };
  }
}
