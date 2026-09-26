import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { Permission } from '@bookorbit/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { BookDuplicatesService } from './book-duplicates.service';
import { CreateBookDuplicateDismissalDto, CreateBookDuplicateScanDto, ListBookDuplicateGroupsDto } from './dto/book-duplicate.dto';

@Controller('book-duplicates')
@RequirePermission(Permission.LibraryDeleteBooks)
export class BookDuplicatesController {
  constructor(private readonly service: BookDuplicatesService) {}

  @Post('scans')
  createScan(@Body() dto: CreateBookDuplicateScanDto, @CurrentUser() user: RequestUser) {
    return this.service.createScan(dto, user);
  }

  @Get('scans/active')
  getActiveScan(@CurrentUser() user: RequestUser) {
    return this.service.getActiveScan(user);
  }

  @Get('scans/:scanId')
  getScan(@Param('scanId', ParseIntPipe) scanId: number, @CurrentUser() user: RequestUser) {
    return this.service.getScan(scanId, user);
  }

  @Get('scans/:scanId/groups')
  getGroups(@Param('scanId', ParseIntPipe) scanId: number, @Query() dto: ListBookDuplicateGroupsDto, @CurrentUser() user: RequestUser) {
    return this.service.getGroups(scanId, dto, user);
  }

  @Get('dismissals')
  listDismissals(@CurrentUser() user: RequestUser) {
    return this.service.listDismissals(user);
  }

  @Post('dismissals')
  @HttpCode(HttpStatus.NO_CONTENT)
  dismissGroup(@Body() dto: CreateBookDuplicateDismissalDto, @CurrentUser() user: RequestUser) {
    return this.service.dismissGroup(dto, user);
  }

  @Delete('dismissals/:bookIdA/:bookIdB')
  @HttpCode(HttpStatus.NO_CONTENT)
  restoreDismissal(
    @Param('bookIdA', ParseIntPipe) bookIdA: number,
    @Param('bookIdB', ParseIntPipe) bookIdB: number,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.restoreDismissal(bookIdA, bookIdB, user);
  }
}
