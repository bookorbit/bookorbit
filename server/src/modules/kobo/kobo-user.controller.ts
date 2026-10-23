import { Permission, AuditAction, AuditResource } from '@bookorbit/types';
import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Auditable } from '../../common/decorators/auditable.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { CreateDeviceDto } from './dto/create-device.dto';
import { RenameDeviceDto } from './dto/rename-device.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { KoboReplacementDto } from './dto/kobo-replacement.dto';
import { KoboDeliveryService } from './services/kobo-delivery.service';
import { KoboDeviceService } from './services/kobo-device.service';
import { KoboSettingsService } from './services/kobo-settings.service';
import { KoboSyncHistoryService } from './services/kobo-sync-history.service';

@Controller('kobo')
@RequirePermission(Permission.KoboSync)
export class KoboUserController {
  constructor(
    private readonly deviceService: KoboDeviceService,
    private readonly settingsService: KoboSettingsService,
    private readonly historyService: KoboSyncHistoryService,
    private readonly deliveries: KoboDeliveryService,
  ) {}

  @Get('devices')
  listDevices(@CurrentUser() user: RequestUser) {
    return this.deviceService.listDevices(user.id);
  }

  @Post('devices')
  @Auditable({
    action: AuditAction.KoboDeviceRegister,
    resource: AuditResource.KoboDevice,
    getResourceId: (_, res: unknown) => (res as { id?: number })?.id,
    description: (req) => `Registered Kobo device '${(req.body as { name?: string })?.name ?? 'unknown'}'`,
  })
  createDevice(@Body() dto: CreateDeviceDto, @CurrentUser() user: RequestUser) {
    return this.deviceService.createDevice(user.id, dto.name);
  }

  @Patch('devices/:id')
  @Auditable({
    action: AuditAction.KoboDeviceRename,
    resource: AuditResource.KoboDevice,
    getResourceId: (req) => parseInt(req.params['id'], 10),
    description: (req) => `Renamed Kobo device #${req.params['id']} to '${(req.body as { name?: string })?.name ?? 'unknown'}'`,
  })
  renameDevice(@Param('id', ParseIntPipe) id: number, @Body() dto: RenameDeviceDto, @CurrentUser() user: RequestUser) {
    return this.deviceService.renameDevice(user.id, id, dto.name);
  }

  @Delete('devices/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditable({
    action: AuditAction.KoboDeviceRemove,
    resource: AuditResource.KoboDevice,
    getResourceId: (req) => parseInt(req.params['id'] as string, 10),
    description: (req) => `Removed Kobo device #${req.params['id']}`,
  })
  revokeDevice(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.deviceService.revokeDevice(user.id, id);
  }

  @Get('settings')
  getSettings(@CurrentUser() user: RequestUser) {
    return this.settingsService.getSettings(user.id);
  }

  @Patch('settings')
  updateSettings(@Body() dto: UpdateSettingsDto, @CurrentUser() user: RequestUser) {
    return this.settingsService.updateSettings(user.id, dto);
  }

  @Get('devices/:id/books/:bookId/delivery')
  getDelivery(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) deviceId: number, @Param('bookId', ParseIntPipe) bookId: number) {
    return this.deliveries.current(user.id, deviceId, bookId);
  }

  @Get('devices/:id/replacements/:deliveryId')
  getReplacement(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) deviceId: number, @Param('deliveryId', ParseUUIDPipe) id: string) {
    return this.deliveries.byId(user.id, deviceId, id);
  }

  @Post('devices/:id/books/:bookId/replacement')
  prepareReplacement(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseIntPipe) deviceId: number,
    @Param('bookId', ParseIntPipe) bookId: number,
    @Body() body: KoboReplacementDto,
  ) {
    return this.deliveries.beginReplacement(user.id, deviceId, bookId, body.variant);
  }

  @Post('devices/:id/replacements/:deliveryId/offer')
  offerReplacement(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) deviceId: number, @Param('deliveryId', ParseUUIDPipe) id: string) {
    return this.deliveries.offerReplacement(user.id, deviceId, id);
  }

  @Post('devices/:id/replacements/:deliveryId/confirm')
  confirmReplacement(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) deviceId: number, @Param('deliveryId', ParseUUIDPipe) id: string) {
    return this.deliveries.confirm(user.id, deviceId, id);
  }

  @Post('devices/:id/replacements/:deliveryId/cancel')
  cancelReplacement(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) deviceId: number, @Param('deliveryId', ParseUUIDPipe) id: string) {
    return this.deliveries.cancelReplacement(user.id, deviceId, id);
  }

  @Get('history')
  listHistory(@CurrentUser() user: RequestUser, @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number) {
    return this.historyService.listForUser(user.id, limit);
  }
}
