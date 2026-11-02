import { AuditAction, AuditResource, Permission } from '@bookorbit/types';
import { Controller, DefaultValuePipe, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';

import { Auditable } from '../../common/decorators/auditable.decorator';
import { RequireLibraryAccess } from '../../common/decorators/require-library-access.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { RegexMetadataReapplyService } from './regex-metadata-reapply.service';
import { ScannerService } from './scanner.service';

@Controller('scanner')
export class ScannerController {
  constructor(
    private readonly scannerService: ScannerService,
    private readonly regexReapply: RegexMetadataReapplyService,
  ) {}

  @Post('libraries/:id/scan')
  @RequirePermission(Permission.ManageLibraries)
  @HttpCode(HttpStatus.ACCEPTED)
  scan(@Param('id', ParseIntPipe) libraryId: number) {
    return this.scannerService.startScan(libraryId, 'manual');
  }

  /**
   * Scan errors can name server paths, so this needs access to the library itself and not just the
   * global permission to manage libraries.
   */
  @Get('libraries/:id/scan-history')
  @RequirePermission(Permission.ManageLibraries)
  @RequireLibraryAccess('viewer')
  scanHistory(@Param('id', ParseIntPipe) libraryId: number, @Query('limit', new DefaultValuePipe(5), ParseIntPipe) limit: number) {
    return this.scannerService.getScanHistory(libraryId, limit);
  }

  @Get('libraries/:id/reapply-regex-metadata')
  @RequirePermission(Permission.ManageLibraries)
  @RequireLibraryAccess('editor')
  getRegexReapply(@Param('id', ParseIntPipe) libraryId: number, @CurrentUser() user: RequestUser) {
    return this.regexReapply.get(libraryId, user);
  }

  /** Writes only the fields the saved rules decide, so it is safe to run on a library with fetched metadata. */
  @Post('libraries/:id/reapply-regex-metadata')
  @RequirePermission(Permission.ManageLibraries)
  @RequireLibraryAccess('editor')
  @HttpCode(HttpStatus.ACCEPTED)
  @Auditable({
    action: AuditAction.LibraryReapplyRegexMetadata,
    resource: AuditResource.Library,
    getResourceId: (req) => parseInt(req.params['id'], 10),
    description: (req) => `Started applying path rules to existing books in library #${req.params['id']}`,
  })
  reapplyRegexMetadata(@Param('id', ParseIntPipe) libraryId: number, @CurrentUser() user: RequestUser) {
    return this.regexReapply.start(libraryId, user);
  }

  @Post('libraries/:id/refresh-covers')
  @RequirePermission(Permission.ManageLibraries)
  @HttpCode(HttpStatus.ACCEPTED)
  refreshCovers(@Param('id', ParseIntPipe) libraryId: number) {
    return this.scannerService.refreshCovers(libraryId);
  }
}
