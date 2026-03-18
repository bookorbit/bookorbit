import { Controller, ForbiddenException, Get, Query } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { AuditService } from './audit.service';

@Controller('audit-log')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  getAuditLogs(@CurrentUser() user: RequestUser, @Query() query: AuditLogQueryDto) {
    if (!user.isSuperuser) throw new ForbiddenException();

    return this.auditService.getAuditLogs({
      userId: query.userId,
      action: query.action,
      resource: query.resource,
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
      dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 50,
    });
  }
}
