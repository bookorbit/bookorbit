import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { AuditAction, AuditResource, Permission } from '@bookorbit/types';

import { Auditable } from '../../common/decorators/auditable.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireAnyPermission } from '../../common/decorators/require-any-permission.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { BookDuplicateResolutionService } from './book-duplicate-resolution.service';
import { BookDuplicatesService } from './book-duplicates.service';
import {
  CreateBookDuplicateDismissalDto,
  CreateBookDuplicateResolutionDto,
  CreateBookDuplicateScanDto,
  ListBookDuplicateGroupsDto,
  RestoreBookDuplicateDismissalDto,
} from './dto/book-duplicate.dto';

/**
 * Finding duplicates is open to anyone who may delete or merge books (H11). What a resolution does
 * to each group is checked per action in the service: delete needs the delete permission, merge and
 * link the merge permission.
 */
@Controller('book-duplicates')
@RequirePermission(Permission.LibraryDeleteBooks)
export class BookDuplicatesController {
  constructor(
    private readonly service: BookDuplicatesService,
    private readonly resolutions: BookDuplicateResolutionService,
  ) {}

  @Post('scans')
  @RequireAnyPermission(Permission.LibraryDeleteBooks, Permission.LibraryMergeBooks)
  createScan(@Body() dto: CreateBookDuplicateScanDto, @CurrentUser() user: RequestUser) {
    return this.service.createScan(dto, user);
  }

  @Get('scans/active')
  @RequireAnyPermission(Permission.LibraryDeleteBooks, Permission.LibraryMergeBooks)
  getActiveScan(@CurrentUser() user: RequestUser) {
    return this.service.getActiveScan(user);
  }

  @Get('scans/:scanId')
  @RequireAnyPermission(Permission.LibraryDeleteBooks, Permission.LibraryMergeBooks)
  getScan(@Param('scanId', ParseIntPipe) scanId: number, @CurrentUser() user: RequestUser) {
    return this.service.getScan(scanId, user);
  }

  @Get('scans/:scanId/groups')
  @RequireAnyPermission(Permission.LibraryDeleteBooks, Permission.LibraryMergeBooks)
  getGroups(@Param('scanId', ParseIntPipe) scanId: number, @Query() dto: ListBookDuplicateGroupsDto, @CurrentUser() user: RequestUser) {
    return this.service.getGroups(scanId, dto, user);
  }

  @Get('dismissals')
  @RequireAnyPermission(Permission.LibraryDeleteBooks, Permission.LibraryMergeBooks)
  listDismissals(@CurrentUser() user: RequestUser) {
    return this.service.listDismissals(user);
  }

  @Post('dismissals')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireAnyPermission(Permission.LibraryDeleteBooks, Permission.LibraryMergeBooks)
  dismissGroup(@Body() dto: CreateBookDuplicateDismissalDto, @CurrentUser() user: RequestUser) {
    return this.service.dismissGroup(dto, user);
  }

  @Delete('dismissals/:bookIdA/:bookIdB')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireAnyPermission(Permission.LibraryDeleteBooks, Permission.LibraryMergeBooks)
  restoreDismissal(
    @Param('bookIdA', ParseIntPipe) bookIdA: number,
    @Param('bookIdB', ParseIntPipe) bookIdB: number,
    @Query() dto: RestoreBookDuplicateDismissalDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.restoreDismissal(bookIdA, bookIdB, user, dto.kind);
  }

  @Post('resolutions')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireAnyPermission(Permission.LibraryDeleteBooks, Permission.LibraryMergeBooks)
  @Auditable({
    action: AuditAction.BookDuplicatesResolve,
    resource: AuditResource.Book,
    getMeta: (req, response) => {
      const body = req.body as { scanId?: number; groups?: unknown[]; allGroups?: { action?: string }; removeIdenticalCopies?: boolean };
      const started = response as { jobId?: number; total?: number } | undefined;
      return {
        scanId: body?.scanId,
        jobId: started?.jobId,
        total: started?.total,
        explicitGroups: body?.groups?.length ?? 0,
        allGroups: body?.allGroups !== undefined,
        removeIdenticalCopies: body?.removeIdenticalCopies === true,
      };
    },
    description: (req, response) => {
      const total = (response as { total?: number } | undefined)?.total ?? 0;
      return `Resolved ${total} duplicate book group(s) from scan #${(req.body as { scanId?: number })?.scanId}`;
    },
  })
  startResolution(@Body() dto: CreateBookDuplicateResolutionDto, @CurrentUser() user: RequestUser) {
    return this.resolutions.start(dto, user);
  }

  @Get('resolutions/:jobId')
  @RequireAnyPermission(Permission.LibraryDeleteBooks, Permission.LibraryMergeBooks)
  getResolution(@Param('jobId', ParseIntPipe) jobId: number, @CurrentUser() user: RequestUser) {
    return this.resolutions.getJob(jobId, user);
  }
}
