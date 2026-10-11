import { Body, Controller, Get, Header, Param, Patch, Put, UseGuards } from '@nestjs/common';
import { Permission } from '@bookorbit/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { KoreaderAuthGuard } from './koreader-auth.guard';
import { KoreaderDeliveryService } from './koreader-delivery.service';
import { KoreaderDeviceParamDto } from './dto/koreader-device-param.dto';
import { MigrateKoreaderDeliverySettingsDto, UpdateKoreaderDeliverySettingsDto } from './dto/koreader-delivery-settings.dto';

@Controller('koreader')
export class KoreaderDeliveryController {
  constructor(private readonly deliveryService: KoreaderDeliveryService) {}

  @Public()
  @UseGuards(KoreaderAuthGuard)
  @Get('plugin/delivery-settings/:deviceId')
  @Header('Cache-Control', 'no-store')
  getSettings(@CurrentUser() user: RequestUser, @Param() params: KoreaderDeviceParamDto) {
    return this.deliveryService.getSettings(user.id, params.deviceId);
  }

  @Public()
  @UseGuards(KoreaderAuthGuard)
  @Put('plugin/delivery-settings/:deviceId')
  @Header('Cache-Control', 'no-store')
  updatePluginSettings(@CurrentUser() user: RequestUser, @Param() params: KoreaderDeviceParamDto, @Body() dto: MigrateKoreaderDeliverySettingsDto) {
    return this.deliveryService.updateSettings(user.id, params.deviceId, dto.readAloudDelivery, dto.migrateOnly);
  }

  @RequirePermission(Permission.KoreaderSync)
  @Patch('devices/:deviceId/delivery-settings')
  updateSettings(@CurrentUser() user: RequestUser, @Param() params: KoreaderDeviceParamDto, @Body() dto: UpdateKoreaderDeliverySettingsDto) {
    return this.deliveryService.updateSettings(user.id, params.deviceId, dto.readAloudDelivery);
  }
}
