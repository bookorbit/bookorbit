import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';

import type { BookQuery } from '@projectx/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { BookQueryPipe } from '../book/pipes/book-query.pipe';
import { BookService } from '../book/book.service';
import { CreateLibraryDto } from './dto/create-library.dto';
import { GrantLibraryAccessDto } from './dto/grant-library-access.dto';
import { PrescanLibraryDto } from './dto/prescan-library.dto';
import { ReorderLibrariesDto } from './dto/reorder-libraries.dto';
import { UpdateLibraryAccessDto } from './dto/update-library-access.dto';
import { UpdateLibraryDto } from './dto/update-library.dto';
import { LibraryService } from './library.service';

@Controller('libraries')
export class LibraryController {
  constructor(
    private readonly libraryService: LibraryService,
    private readonly bookService: BookService,
  ) {}

  @Get()
  findAll(@CurrentUser() user: RequestUser) {
    return this.libraryService.findAll(user);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    const isSuperuser = user.roles.some((r) => r.isSuperuser);
    return this.libraryService.verifyUserAccess(user.id, id, isSuperuser).then(() => this.libraryService.findOne(id));
  }

  @Post(':id/books')
  queryBooks(@Param('id', ParseIntPipe) libraryId: number, @Body(BookQueryPipe) query: BookQuery, @CurrentUser() user: RequestUser) {
    return this.bookService.queryForLibrary(user, libraryId, query);
  }

  @Post()
  @RequirePermission('manage_libraries')
  create(@Body() dto: CreateLibraryDto) {
    return this.libraryService.create(dto);
  }

  @Patch(':id')
  @RequirePermission('manage_libraries')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateLibraryDto) {
    return this.libraryService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('manage_libraries')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.libraryService.remove(id);
  }

  @Post('prescan')
  @RequirePermission('manage_libraries')
  prescan(@Body() dto: PrescanLibraryDto) {
    return this.libraryService.prescan(dto);
  }

  @Post('reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('manage_libraries')
  reorder(@Body() dto: ReorderLibrariesDto) {
    return this.libraryService.reorder(dto);
  }

  @Get(':id/stats')
  getStats(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    const isSuperuser = user.roles.some((r) => r.isSuperuser);
    return this.libraryService.verifyUserAccess(user.id, id, isSuperuser).then(() => this.libraryService.getStats(id));
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
