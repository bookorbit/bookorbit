import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { Permission, AuditAction, AuditResource } from '@bookorbit/types';
import type { BookQuery, BulkRenameProgressEvent, LibraryFileSyncProgressEvent } from '@bookorbit/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireLibraryAccess } from '../../common/decorators/require-library-access.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Auditable } from '../../common/decorators/auditable.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { BookQueryPipe } from '../book/pipes/book-query.pipe';
import { BookService } from '../book/book.service';
import { BulkRenamePreviewQueryDto } from './dto/bulk-rename-preview-query.dto';
import { CreateLibraryDto } from './dto/create-library.dto';
import { GrantLibraryAccessDto } from './dto/grant-library-access.dto';
import { PrescanLibraryDto } from './dto/prescan-library.dto';
import { ReorderLibrariesDto } from './dto/reorder-libraries.dto';
import { UpdateLibraryAccessDto } from './dto/update-library-access.dto';
import { UpdateLibraryDto } from './dto/update-library.dto';
import { BulkRenameService } from './bulk-rename.service';
import { LibraryService } from './library.service';

@Controller('libraries')
export class LibraryController {
  constructor(
    private readonly libraryService: LibraryService,
    private readonly bookService: BookService,
    private readonly bulkRenameService: BulkRenameService,
  ) {}

  @Get()
  findAll(@CurrentUser() user: RequestUser) {
    return this.libraryService.findAll(user);
  }

  @Get(':id')
  @RequireLibraryAccess('viewer')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.libraryService.findOne(id);
  }

  @Post(':id/books')
  @RequireLibraryAccess('viewer')
  queryBooks(@Param('id', ParseIntPipe) libraryId: number, @Body(BookQueryPipe) query: BookQuery, @CurrentUser() user: RequestUser) {
    return this.bookService.queryForLibrary(user, libraryId, query);
  }

  @Post(':id/books/jump-buckets')
  @RequireLibraryAccess('viewer')
  queryJumpBuckets(@Param('id', ParseIntPipe) libraryId: number, @Body(BookQueryPipe) query: BookQuery, @CurrentUser() user: RequestUser) {
    return this.bookService.queryJumpBucketsForLibrary(user, libraryId, query);
  }

  @Post()
  @RequirePermission(Permission.ManageLibraries)
  @Auditable({
    action: AuditAction.LibraryCreate,
    resource: AuditResource.Library,
    getResourceId: (_, res: unknown) => (res as { id?: number })?.id,
    description: (_, res: unknown) => `Created library '${(res as { name?: string })?.name ?? 'unknown'}'`,
  })
  create(@Body() dto: CreateLibraryDto) {
    return this.libraryService.create(dto);
  }

  @Patch(':id')
  @RequirePermission(Permission.ManageLibraries)
  @Auditable({
    action: AuditAction.LibraryUpdate,
    resource: AuditResource.Library,
    getResourceId: (req) => parseInt(req.params['id'] as string, 10),
    description: (req) => `Updated library #${req.params['id']}`,
  })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateLibraryDto) {
    return this.libraryService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.ManageLibraries)
  @Auditable({
    action: AuditAction.LibraryDelete,
    resource: AuditResource.Library,
    getResourceId: (req) => parseInt(req.params['id'] as string, 10),
    description: (req) => `Deleted library #${req.params['id']}`,
  })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.libraryService.remove(id);
  }

  @Post('prescan')
  @RequirePermission(Permission.ManageLibraries)
  prescan(@Body() dto: PrescanLibraryDto) {
    return this.libraryService.prescan(dto);
  }

  @Post('reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.ManageLibraries)
  reorder(@Body() dto: ReorderLibrariesDto) {
    return this.libraryService.reorder(dto);
  }

  @Get(':id/stats')
  @RequireLibraryAccess('viewer')
  getStats(@Param('id', ParseIntPipe) id: number) {
    return this.libraryService.getStats(id);
  }

  @Post(':id/write-metadata-to-files')
  @RequireLibraryAccess('editor')
  @RequirePermission(Permission.LibraryEditMetadata)
  @Auditable({
    action: AuditAction.LibraryWriteMetadataToFiles,
    resource: AuditResource.Library,
    getResourceId: (req) => parseInt(req.params['id'], 10),
    description: (req) => `Wrote metadata to files for library #${req.params['id']}`,
  })
  async writeMetadataToFiles(
    @Param('id', ParseIntPipe) libraryId: number,
    @Query('dryRun') dryRunParam: string | undefined,
    @CurrentUser() user: RequestUser,
    @Res() reply: FastifyReply,
  ) {
    const dryRun = dryRunParam === 'true';

    let disconnected = false;
    let streamStarted = false;
    const handleDisconnect = () => {
      disconnected = true;
    };

    const ensureStreamStarted = () => {
      if (streamStarted) return;
      streamStarted = true;
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      reply.raw.on('close', handleDisconnect);
      reply.raw.on('aborted', handleDisconnect);
    };

    const writeEvent = (event: LibraryFileSyncProgressEvent) => {
      if (disconnected || reply.raw.writableEnded || reply.raw.destroyed) return;
      ensureStreamStarted();
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      const summary = await this.libraryService.writeMetadataToFiles(libraryId, user.id, dryRun, {
        onProgress: writeEvent,
        isCancelled: () => disconnected || reply.raw.writableEnded || reply.raw.destroyed,
      });

      const doneEvent: LibraryFileSyncProgressEvent = {
        done: true,
        processed: summary.processed,
        succeeded: summary.succeeded,
        failed: summary.failed,
        skipped: summary.skipped,
      };
      writeEvent(doneEvent);

      if (streamStarted && !reply.raw.writableEnded && !reply.raw.destroyed) {
        reply.raw.end();
      }
    } catch (error) {
      if (streamStarted && !reply.raw.writableEnded && !reply.raw.destroyed) {
        reply.raw.end();
        return;
      }
      throw error;
    } finally {
      if (streamStarted) {
        reply.raw.off('close', handleDisconnect);
        reply.raw.off('aborted', handleDisconnect);
      }
    }
  }

  // ── Library access management ─────────────────────────────────────────────

  @Get(':libraryId/access')
  @RequirePermission(Permission.ManageLibraries)
  getAccess(@Param('libraryId', ParseIntPipe) libraryId: number) {
    return this.libraryService.getAccess(libraryId);
  }

  @Post(':libraryId/access')
  @RequirePermission(Permission.ManageLibraries)
  @Auditable({
    action: AuditAction.LibraryAccessGrant,
    resource: AuditResource.Library,
    getResourceId: (req) => parseInt(req.params['libraryId'] as string, 10),
    description: (req) => `Granted library #${req.params['libraryId']} access to user #${(req.body as { userId?: number })?.userId}`,
  })
  grantAccess(@Param('libraryId', ParseIntPipe) libraryId: number, @Body() dto: GrantLibraryAccessDto) {
    return this.libraryService.grantAccess(libraryId, dto);
  }

  @Patch(':libraryId/access/:userId')
  @RequirePermission(Permission.ManageLibraries)
  @Auditable({
    action: AuditAction.LibraryAccessUpdate,
    resource: AuditResource.Library,
    getResourceId: (req) => parseInt(req.params['libraryId'] as string, 10),
    description: (req) => `Updated library #${req.params['libraryId']} access for user #${req.params['userId']}`,
  })
  updateAccess(
    @Param('libraryId', ParseIntPipe) libraryId: number,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: UpdateLibraryAccessDto,
  ) {
    return this.libraryService.updateAccess(libraryId, userId, dto.accessLevel);
  }

  @Delete(':libraryId/access/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.ManageLibraries)
  @Auditable({
    action: AuditAction.LibraryAccessRevoke,
    resource: AuditResource.Library,
    getResourceId: (req) => parseInt(req.params['libraryId'] as string, 10),
    description: (req) => `Revoked library #${req.params['libraryId']} access from user #${req.params['userId']}`,
  })
  revokeAccess(@Param('libraryId', ParseIntPipe) libraryId: number, @Param('userId', ParseIntPipe) userId: number) {
    return this.libraryService.revokeAccess(libraryId, userId);
  }

  // ── Bulk rename ────────────────────────────────────────────────────────────

  @Get(':id/bulk-rename/preview')
  @RequireLibraryAccess('editor')
  @RequirePermission(Permission.ManageLibraries)
  getBulkRenamePreview(@Param('id', ParseIntPipe) libraryId: number, @Query() query: BulkRenamePreviewQueryDto) {
    return this.bulkRenameService.getPreview(libraryId, query.page, query.pageSize, query.status);
  }

  @Get(':id/bulk-rename/status')
  @RequireLibraryAccess('editor')
  @RequirePermission(Permission.ManageLibraries)
  getBulkRenameStatus(@Param('id', ParseIntPipe) libraryId: number) {
    return { running: this.bulkRenameService.isRunning(libraryId) };
  }

  @Post(':id/bulk-rename/execute')
  @RequireLibraryAccess('editor')
  @RequirePermission(Permission.ManageLibraries)
  @Auditable({
    action: AuditAction.LibraryBulkRename,
    resource: AuditResource.Library,
    getResourceId: (req) => parseInt(req.params['id'], 10),
    description: (req) => `Bulk renamed books in library #${req.params['id']}`,
  })
  async executeBulkRename(@Param('id', ParseIntPipe) libraryId: number, @CurrentUser() user: RequestUser, @Res() reply: FastifyReply) {
    let disconnected = false;
    let streamStarted = false;
    const handleDisconnect = () => {
      disconnected = true;
    };

    const ensureStreamStarted = () => {
      if (streamStarted) return;
      streamStarted = true;
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      reply.raw.on('close', handleDisconnect);
      reply.raw.on('aborted', handleDisconnect);
    };

    const writeEvent = (event: BulkRenameProgressEvent) => {
      if (disconnected || reply.raw.writableEnded || reply.raw.destroyed) return;
      ensureStreamStarted();
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      const summary = await this.bulkRenameService.execute(libraryId, user.id, {
        onProgress: writeEvent,
        isCancelled: () => disconnected || reply.raw.writableEnded || reply.raw.destroyed,
      });

      const doneEvent: BulkRenameProgressEvent = {
        done: true,
        processed: summary.processed,
        succeeded: summary.succeeded,
        failed: summary.failed,
        skipped: summary.skipped,
      };
      writeEvent(doneEvent);

      if (streamStarted && !reply.raw.writableEnded && !reply.raw.destroyed) {
        reply.raw.end();
      }
    } catch (error) {
      if (streamStarted && !reply.raw.writableEnded && !reply.raw.destroyed) {
        reply.raw.end();
        return;
      }
      throw error;
    } finally {
      if (streamStarted) {
        reply.raw.off('close', handleDisconnect);
        reply.raw.off('aborted', handleDisconnect);
      }
    }
  }
}
