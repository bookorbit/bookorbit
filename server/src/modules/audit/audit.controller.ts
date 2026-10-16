import { Controller, Get, Query, Res } from '@nestjs/common';
import { Readable } from 'stream';
import type { FastifyReply } from 'fastify';
import { Permission } from '@bookorbit/types';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { contentDispositionHeader } from '../../common/utils/content-disposition.utils';
import { AuditActorQueryDto, AuditExportQueryDto, AuditFilterQueryDto, AuditLogQueryDto, AuditSignInQueryDto } from './dto/audit-log-query.dto';
import { AuditService, type AuditLogFilters } from './audit.service';

function toFilters(query: AuditFilterQueryDto): AuditLogFilters {
  return {
    userId: query.userId,
    search: query.search,
    actorUsername: query.actorUsername,
    action: query.action,
    resource: query.resource,
    resourceId: query.resourceId,
    ip: query.ip,
    kind: query.kind,
    category: query.category,
    securityGroup: query.securityGroup,
    dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
    dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
  };
}

@Controller('audit-log')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('actors')
  @RequirePermission(Permission.ViewAuditLog)
  getActors(@Query() query: AuditActorQueryDto) {
    return this.auditService.getActors(query.q, query.limit!);
  }

  @Get('summary')
  @RequirePermission(Permission.ViewAuditLog)
  getSummary(@Query() query: AuditFilterQueryDto) {
    return this.auditService.getSummary(toFilters(query));
  }

  @Get('sign-ins')
  @RequirePermission(Permission.ViewAuditLog)
  getSignIns(@Query() query: AuditSignInQueryDto) {
    return this.auditService.getSignIns({
      search: query.search,
      actorUsername: query.actorUsername,
      ip: query.ip,
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
      dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
      tz: query.tz!,
      page: query.page!,
      pageSize: query.pageSize!,
    });
  }

  @Get('export')
  @RequirePermission(Permission.ViewAuditLog)
  exportEvents(@Query() query: AuditExportQueryDto, @Res() reply: FastifyReply) {
    const format = query.format ?? 'csv';
    const filename = `audit-log-${new Date().toISOString().slice(0, 10)}.${format}`;
    reply.type(format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8');
    reply.header('Content-Disposition', contentDispositionHeader('attachment', filename, filename));
    reply.header('Cache-Control', 'no-store');
    reply.send(Readable.from(this.auditService.exportEvents(toFilters(query), format)));
  }

  @Get()
  @RequirePermission(Permission.ViewAuditLog)
  getAuditLogs(@Query() query: AuditLogQueryDto) {
    return this.auditService.getAuditLogs({
      ...toFilters(query),
      page: query.page!,
      pageSize: query.pageSize!,
    });
  }
}
