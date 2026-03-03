import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import type { BookQuery, LibraryFileSyncProgressEvent, WriteResult } from '@projectx/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { FileWriteRepository } from '../file-write/file-write.repository';
import { FileWriteService } from '../file-write/file-write.service';
import { FileWriteSettingsService } from '../file-write/file-write-settings.service';
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
    private readonly fileWriteService: FileWriteService,
    private readonly fileWriteRepo: FileWriteRepository,
    private readonly fileWriteSettings: FileWriteSettingsService,
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

  @Post(':id/write-metadata-to-files')
  @RequirePermission('library_edit_metadata')
  async writeMetadataToFiles(
    @Param('id', ParseIntPipe) libraryId: number,
    @Query('dryRun') dryRunParam: string | undefined,
    @CurrentUser() user: RequestUser,
    @Res() reply: FastifyReply,
  ) {
    const isSuperuser = user.roles.some((r) => r.isSuperuser);
    await this.libraryService.verifyUserAccess(user.id, libraryId, isSuperuser);

    const dryRun = dryRunParam === 'true';

    if (!dryRun) {
      const settings = await this.fileWriteSettings.resolve(libraryId);
      if (!settings.enabled) {
        throw new BadRequestException('Metadata file write is not enabled. Enable it in Maintenance settings first.');
      }
    }

    const rows = await this.fileWriteRepo.findNonMissingBookFilesByLibrary(libraryId);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    for (const row of rows) {
      let result: WriteResult;
      try {
        result = await this.fileWriteService.writeToFile(row.bookId, 'sync', user.id, dryRun);
      } catch (err) {
        result = { status: 'failed', fieldsWritten: [], durationMs: 0, reason: (err as Error).message };
      }

      if (result.status === 'success') succeeded++;
      else if (result.status === 'failed') failed++;
      else skipped++;

      const event: LibraryFileSyncProgressEvent = { bookId: row.bookId, status: result.status, reason: result.reason };
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    const doneEvent: LibraryFileSyncProgressEvent = { done: true, processed: rows.length, succeeded, failed, skipped };
    reply.raw.write(`data: ${JSON.stringify(doneEvent)}\n\n`);
    reply.raw.end();
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
