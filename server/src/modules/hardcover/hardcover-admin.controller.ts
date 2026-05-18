import { Body, Controller, Get, Patch } from '@nestjs/common';

import { Permission } from '@bookorbit/types';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { SetHardcoverFeatureEnabledDto } from './dto';
import { HardcoverSettingsService } from './hardcover-settings.service';

@Controller('admin/hardcover')
export class HardcoverAdminController {
  constructor(private readonly settingsService: HardcoverSettingsService) {}

  @Get('settings')
  @RequirePermission(Permission.ManageAppSettings)
  getAdminSettings() {
    return this.settingsService.getAdminSettings();
  }

  @Patch('settings')
  @RequirePermission(Permission.ManageAppSettings)
  setFeatureEnabled(@Body() dto: SetHardcoverFeatureEnabledDto) {
    return this.settingsService.setFeatureEnabled(dto.enabled);
  }
}
