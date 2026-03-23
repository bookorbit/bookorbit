import { Permission } from '@projectx/types';
import { Controller, ForbiddenException, Get, Query } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { QuerySendLogDto } from './dto/query-send-log.dto';
import { EmailSendLogService } from './email-send-log.service';

@Controller('email/admin/log')
@RequirePermission(Permission.ManageEmail)
export class EmailAdminLogController {
  constructor(private readonly logService: EmailSendLogService) {}

  @Get()
  findAll(@Query() query: QuerySendLogDto, @CurrentUser() user: RequestUser) {
    if (!user.isSuperuser) {
      throw new ForbiddenException('Only superusers can view all email logs');
    }
    return this.logService.findAllAdmin(query.page ?? 0, query.size ?? 20);
  }
}
