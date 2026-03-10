import { Permission } from '@projectx/types';
import { Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { QuerySendLogDto } from './dto/query-send-log.dto';
import { EmailSendLogService } from './email-send-log.service';
import { EmailSendOrchestrator } from './email-send-orchestrator.service';

@Controller('email/log')
@RequirePermission(Permission.EmailSend)
export class EmailSendLogController {
  constructor(
    private readonly logService: EmailSendLogService,
    private readonly orchestrator: EmailSendOrchestrator,
  ) {}

  @Get()
  findForUser(@Query() query: QuerySendLogDto, @CurrentUser() user: RequestUser) {
    return this.logService.findForUser(user, query.page ?? 0, query.size ?? 20);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.logService.remove(id, user);
  }

  @Post(':id/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  resend(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.orchestrator.resend(id, user);
  }
}
