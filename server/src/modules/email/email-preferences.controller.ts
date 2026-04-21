import { Permission } from '@bookorbit/types';
import { Body, Controller, Get, HttpCode, HttpStatus, Put } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { UpdateEmailPreferencesDto } from './dto/update-email-preferences.dto';
import { EmailPreferencesService } from './email-preferences.service';

@Controller('email/preferences')
@RequirePermission(Permission.EmailSend)
export class EmailPreferencesController {
  constructor(private readonly service: EmailPreferencesService) {}

  @Get()
  findForUser(@CurrentUser() user: RequestUser) {
    return this.service.findForUser(user);
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  upsert(@Body() dto: UpdateEmailPreferencesDto, @CurrentUser() user: RequestUser) {
    return this.service.upsert(dto, user);
  }
}
