import { Controller, Get, Query } from '@nestjs/common';
import { Permission } from '@bookorbit/types';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { AuditService } from './audit.service';

@Controller('audit-log')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @RequirePermission(Permission.ViewAuditLog)
  getAuditLogs(@Query() query: AuditLogQueryDto) {
    return this.auditService.getAuditLogs({
      userId: query.userId,
      action: query.action,
      resource: query.resource,
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
      dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
      page: query.page!,
      pageSize: query.pageSize!,
    });
  }
}
