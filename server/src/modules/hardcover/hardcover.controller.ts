import { Body, Controller, Delete, Get, MessageEvent, Patch, Post, Sse } from '@nestjs/common';
import { map, Observable } from 'rxjs';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { UpsertHardcoverSettingsDto, ValidateHardcoverTokenDto } from './dto';
import { HardcoverSettingsService } from './hardcover-settings.service';
import { HardcoverSyncService } from './hardcover-sync.service';

@Controller('hardcover')
export class HardcoverController {
  constructor(
    private readonly settingsService: HardcoverSettingsService,
    private readonly syncService: HardcoverSyncService,
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
}
