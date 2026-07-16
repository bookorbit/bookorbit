import { Permission } from '@bookorbit/types';
import { Body, Controller, Get, Patch, Post } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { UpsertReadwiseSettingsDto, ValidateReadwiseTokenDto } from './dto';
import { ReadwiseSettingsService } from './readwise-settings.service';

@Controller('readwise')
@RequirePermission(Permission.ReadwiseSync)
export class ReadwiseController {
  constructor(private readonly settingsService: ReadwiseSettingsService) {}

  @Get('settings')
  getSettings(@CurrentUser() user: RequestUser) {
    return this.settingsService.getSettings(user.id);
  }

  @Patch('settings')
  upsertSettings(@CurrentUser() user: RequestUser, @Body() dto: UpsertReadwiseSettingsDto) {
    return this.settingsService.upsertSettings(user.id, dto);
  }

  @Post('validate-token')
  validateToken(@CurrentUser() user: RequestUser, @Body() dto: ValidateReadwiseTokenDto) {
    return this.settingsService.validateToken(user.id, dto.token);
  }
}
