import { Controller, HttpCode, HttpStatus, Param, ParseIntPipe, Post } from '@nestjs/common';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ScannerService } from './scanner.service';

@Controller('scanner')
export class ScannerController {
  constructor(private readonly scannerService: ScannerService) {}

  @Post('libraries/:id/scan')
  @RequirePermission('manage_libraries')
  @HttpCode(HttpStatus.ACCEPTED)
  scan(@Param('id', ParseIntPipe) libraryId: number) {
    return this.scannerService.startScan(libraryId, 'manual');
  }

  @Post('libraries/:id/refresh-covers')
  @RequirePermission('manage_libraries')
  @HttpCode(HttpStatus.ACCEPTED)
  refreshCovers(@Param('id', ParseIntPipe) libraryId: number) {
    return this.scannerService.refreshCovers(libraryId);
  }
}
