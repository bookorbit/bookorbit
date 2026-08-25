import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AuditAction, AuditResource, Permission, type MissingResourceCleanupResult } from '@bookorbit/types';

import { Auditable } from '../../common/decorators/auditable.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ForbidPermission } from '../../common/decorators/forbid-permission.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { ListMissingResourcesDto, MissingResourceCleanupDto } from './dto/missing-resources.dto';
import { MissingResourcesService } from './missing-resources.service';

function cleanupDescription(prefix: string) {
  return (_req: unknown, responseBody: unknown) => {
    const result = responseBody as MissingResourceCleanupResult;
    return `${prefix}: cleaned ${result.cleaned}, skipped ${result.skipped}`;
  };
}

function cleanupMeta(_req: unknown, responseBody: unknown) {
  const result = responseBody as MissingResourceCleanupResult;
  return { category: result.category, requested: result.requested, cleaned: result.cleaned, skipped: result.skipped, remaining: result.remaining };
}

@Controller('maintenance/missing-resources')
@RequirePermission(Permission.LibraryDeleteBooks)
export class MissingResourcesController {
  constructor(private readonly service: MissingResourcesService) {}

  @Get()
  getSummary(@CurrentUser() user: RequestUser) {
    return this.service.getSummary(user);
  }

  @Get('sweep')
  getSweep(@CurrentUser() user: RequestUser) {
    return this.service.getSweep(user);
  }

  @Post('sweep')
  startSweep(@CurrentUser() user: RequestUser) {
    return this.service.startSweep(user);
  }

  @Get('books')
  listMissingBooks(@Query() dto: ListMissingResourcesDto, @CurrentUser() user: RequestUser) {
    return this.service.listMissingBooks(user, dto.page, dto.pageSize);
  }

  @Get('broken-covers')
  listBrokenCovers(@Query() dto: ListMissingResourcesDto, @CurrentUser() user: RequestUser) {
    return this.service.listBrokenCovers(user, dto.page, dto.pageSize);
  }

  @Get('orphaned-covers')
  listOrphanedCoverDirs(@Query() dto: ListMissingResourcesDto, @CurrentUser() user: RequestUser) {
    return this.service.listOrphanedCoverDirs(user, dto.page, dto.pageSize);
  }

  @Post('books/clean')
  @RequirePermission(Permission.LibraryDeleteBooks)
  @ForbidPermission(Permission.DemoRestricted, 'Demo-restricted account cannot clean missing resources')
  @Auditable({
    action: AuditAction.MaintenanceMissingBooksClean,
    resource: AuditResource.Book,
    getMeta: cleanupMeta,
    description: cleanupDescription('Removed database records for missing books'),
  })
  cleanMissingBooks(@Body() dto: MissingResourceCleanupDto, @CurrentUser() user: RequestUser) {
    return this.service.cleanMissingBooks(user, dto);
  }

  @Post('broken-covers/clean')
  @RequirePermission(Permission.LibraryDeleteBooks, Permission.LibraryEditMetadata)
  @ForbidPermission(Permission.DemoRestricted, 'Demo-restricted account cannot clean missing resources')
  @Auditable({
    action: AuditAction.MaintenanceBrokenCoversClean,
    resource: AuditResource.Book,
    getMeta: cleanupMeta,
    description: cleanupDescription('Cleared cover references with no file on disk'),
  })
  cleanBrokenCovers(@Body() dto: MissingResourceCleanupDto, @CurrentUser() user: RequestUser) {
    return this.service.cleanBrokenCovers(user, dto);
  }

  @Post('orphaned-covers/clean')
  @RequirePermission(Permission.LibraryDeleteBooks, Permission.ManageLibraries)
  @ForbidPermission(Permission.DemoRestricted, 'Demo-restricted account cannot clean missing resources')
  @Auditable({
    action: AuditAction.MaintenanceOrphanedCoversClean,
    resource: AuditResource.Book,
    getMeta: cleanupMeta,
    description: cleanupDescription('Removed cover folders for deleted books'),
  })
  cleanOrphanedCoverDirs(@Body() dto: MissingResourceCleanupDto, @CurrentUser() user: RequestUser) {
    return this.service.cleanOrphanedCoverDirs(user, dto);
  }
}
