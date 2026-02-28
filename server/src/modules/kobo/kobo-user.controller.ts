import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { CreateDeviceDto } from './dto/create-device.dto';
import { RenameDeviceDto } from './dto/rename-device.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { KoboDeviceService } from './services/kobo-device.service';
import { KoboSettingsService } from './services/kobo-settings.service';

@Controller('kobo')
@RequirePermission('kobo_sync')
export class KoboUserController {
  constructor(
    private readonly deviceService: KoboDeviceService,
    private readonly settingsService: KoboSettingsService,
  ) {}

  @Get('devices')
  listDevices(@CurrentUser() user: RequestUser) {
    return this.deviceService.listDevices(user.id);
  }

  @Post('devices')
  createDevice(@Body() dto: CreateDeviceDto, @CurrentUser() user: RequestUser) {
    return this.deviceService.createDevice(user.id, dto.name);
  }

  @Patch('devices/:id')
  renameDevice(@Param('id', ParseIntPipe) id: number, @Body() dto: RenameDeviceDto, @CurrentUser() user: RequestUser) {
    return this.deviceService.renameDevice(user.id, id, dto.name);
  }

  @Delete('devices/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
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
}
