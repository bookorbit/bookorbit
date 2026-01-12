import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { GrantLibraryAccessDto } from './dto/grant-library-access.dto';
import { UpdateLibraryAccessDto } from './dto/update-library-access.dto';
import { LibraryService } from './library.service';

@Controller('libraries')
export class LibraryController {
  constructor(private readonly libraryService: LibraryService) {}

  @Get()
  findAll(@CurrentUser() user: RequestUser) {
    return this.libraryService.findAll(user);
  }

  // ── Library access management ─────────────────────────────────────────────

  @Get(':libraryId/access')
  @RequirePermission('manage_libraries')
  getAccess(@Param('libraryId', ParseIntPipe) libraryId: number) {
    return this.libraryService.getAccess(libraryId);
  }

  @Post(':libraryId/access')
  @RequirePermission('manage_libraries')
  grantAccess(@Param('libraryId', ParseIntPipe) libraryId: number, @Body() dto: GrantLibraryAccessDto) {
    return this.libraryService.grantAccess(libraryId, dto);
  }

  @Patch(':libraryId/access/:userId')
  @RequirePermission('manage_libraries')
  updateAccess(
    @Param('libraryId', ParseIntPipe) libraryId: number,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: UpdateLibraryAccessDto,
  ) {
    return this.libraryService.updateAccess(libraryId, userId, dto.accessLevel);
  }

  @Delete(':libraryId/access/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('manage_libraries')
  revokeAccess(@Param('libraryId', ParseIntPipe) libraryId: number, @Param('userId', ParseIntPipe) userId: number) {
    return this.libraryService.revokeAccess(libraryId, userId);
  }
}
