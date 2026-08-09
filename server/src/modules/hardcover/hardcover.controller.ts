import { Permission } from '@bookorbit/types';
import { Body, Controller, Delete, Get, MessageEvent, Param, ParseIntPipe, Patch, Post, Sse } from '@nestjs/common';
import { map, Observable } from 'rxjs';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { BookService } from '../book/book.service';
import {
  ApplyHardcoverImportDto,
  SetHardcoverEditionDto,
  UpdateHardcoverBookSyncDto,
  UpsertHardcoverSettingsDto,
  ValidateHardcoverTokenDto,
} from './dto';
import { HardcoverImportService } from './hardcover-import.service';
import { HardcoverSettingsService } from './hardcover-settings.service';
import { HardcoverSyncService } from './hardcover-sync.service';

@Controller('hardcover')
@RequirePermission(Permission.HardcoverSync)
export class HardcoverController {
  constructor(
    private readonly settingsService: HardcoverSettingsService,
    private readonly syncService: HardcoverSyncService,
    private readonly importService: HardcoverImportService,
    private readonly bookService: BookService,
  ) {}

  @Get('settings')
  getSettings(@CurrentUser() user: RequestUser) {
    return this.settingsService.getSettings(user.id);
  }

  @Patch('settings')
  upsertSettings(@CurrentUser() user: RequestUser, @Body() dto: UpsertHardcoverSettingsDto) {
    return this.settingsService.upsertSettings(user.id, dto);
  }

  @Delete('settings')
  disconnectUser(@CurrentUser() user: RequestUser) {
    return this.settingsService.disconnectUser(user.id);
  }

  @Post('validate-token')
  validateToken(@CurrentUser() user: RequestUser, @Body() dto: ValidateHardcoverTokenDto) {
    return this.settingsService.validateToken(user.id, dto.token);
  }

  @Post('sync')
  startSync(@CurrentUser() user: RequestUser) {
    return this.syncService.syncAll(user.id).then((runId) => ({ runId }));
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
    return this.syncService.getSyncPendingSummary(user.id);
  }

  @Get('books')
  listLinkedBooks(@CurrentUser() user: RequestUser) {
    return this.syncService.listLinkedBooks(user.id);
  }

  @Get('books/:bookId/editions')
  async listEditions(@CurrentUser() user: RequestUser, @Param('bookId', ParseIntPipe) bookId: number) {
    await this.bookService.verifyBookAccess(bookId, user);
    return this.syncService.getEditions(user.id, bookId);
  }

  @Patch('books/:bookId/edition')
  async setEdition(@CurrentUser() user: RequestUser, @Param('bookId', ParseIntPipe) bookId: number, @Body() dto: SetHardcoverEditionDto) {
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
    @Body() dto: UpdateHardcoverBookSyncDto,
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

  @Post('import/preview')
  previewImport(@CurrentUser() user: RequestUser) {
    return this.importService.previewImport(user);
  }

  @Post('import/apply')
  applyImport(@CurrentUser() user: RequestUser, @Body() dto: ApplyHardcoverImportDto) {
    return this.importService.applyImport(user, dto);
  }
}
