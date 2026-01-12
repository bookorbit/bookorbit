import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch } from '@nestjs/common';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AppSettingsService } from './app-settings.service';
import { UpdateAppSettingDto } from './dto/update-app-setting.dto';

@Controller('app-settings')
@RequirePermission('manage_app_settings')
export class AppSettingsController {
  constructor(private readonly appSettingsService: AppSettingsService) {}

  @Get()
  findAll() {
    return this.appSettingsService.findAll();
  }

  @Patch(':key')
  @HttpCode(HttpStatus.OK)
  update(@Param('key') key: string, @Body() dto: UpdateAppSettingDto) {
    return this.appSettingsService.update(key, dto.value);
  }
}
