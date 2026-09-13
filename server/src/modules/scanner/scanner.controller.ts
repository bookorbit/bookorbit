import { Permission } from '@bookorbit/types';
import { Controller, DefaultValuePipe, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';

import { RequireLibraryAccess } from '../../common/decorators/require-library-access.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ScannerService } from './scanner.service';

@Controller('scanner')
export class ScannerController {
  constructor(private readonly scannerService: ScannerService) {}

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

  @Post('libraries/:id/refresh-covers')
  @RequirePermission(Permission.ManageLibraries)
  @HttpCode(HttpStatus.ACCEPTED)
  refreshCovers(@Param('id', ParseIntPipe) libraryId: number) {
    return this.scannerService.refreshCovers(libraryId);
  }
}
