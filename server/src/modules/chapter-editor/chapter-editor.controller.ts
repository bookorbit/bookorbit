import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Put, Query, ParseUUIDPipe, Req, Res } from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { withRequestAbort } from '../../common/utils/request-abort.utils';
import { AuditAction, AuditResource, Permission } from '@bookorbit/types';

import { Auditable } from '../../common/decorators/auditable.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { ChapterJobService } from './chapter-job.service';
import { ChapterEditorService } from './chapter-editor.service';
import { AnalyzeBookChaptersDto } from './dto/analyze-book-chapters.dto';
import { EbookBookChaptersDto } from './dto/ebook-book-chapters.dto';
import { LookupBookChaptersDto } from './dto/lookup-book-chapters.dto';
import { RevertBookChaptersDto } from './dto/revert-book-chapters.dto';
import { WaveformBookChaptersDto } from './dto/waveform-book-chapters.dto';
import { SaveBookChaptersDto } from './dto/save-book-chapters.dto';
import { StartChapterJobDto } from './dto/start-chapter-job.dto';
import { WriteBookChaptersDto } from './dto/write-book-chapters.dto';

@Controller('books/:bookId/chapters')
export class ChapterEditorController {
  constructor(
    private readonly service: ChapterEditorService,
    private readonly jobs: ChapterJobService,
  ) {}

  @Post('jobs/write')
  @RequirePermission(Permission.LibraryEditMetadata)
  @Auditable({
    action: AuditAction.BookWriteAndRename,
    resource: AuditResource.Book,
    getResourceId: (req) => parseInt(req.params['bookId'] as string, 10),
    description: (req) => `Queued chapter file write for book #${req.params['bookId']}`,
  })
  startWrite(@Param('bookId', ParseIntPipe) bookId: number, @Body() dto: StartChapterJobDto, @CurrentUser() user: RequestUser) {
    return this.jobs.start(bookId, 'write', dto.baseRevision, user, dto.retry);
  }

  @Post('jobs/read')
  @RequirePermission(Permission.LibraryEditMetadata)
  startRead(@Param('bookId', ParseIntPipe) bookId: number, @Body() dto: StartChapterJobDto, @CurrentUser() user: RequestUser) {
    return this.jobs.start(bookId, 'read', dto.baseRevision, user, dto.retry);
  }

  @Post('jobs/revert')
  @RequirePermission(Permission.LibraryEditMetadata)
  @Auditable({
    action: AuditAction.BookMetadataUpdate,
    resource: AuditResource.Book,
    getResourceId: (req) => parseInt(req.params['bookId'] as string, 10),
    description: (req) => `Queued chapter revert for book #${req.params['bookId']}`,
  })
  startRevert(@Param('bookId', ParseIntPipe) bookId: number, @Body() dto: StartChapterJobDto, @CurrentUser() user: RequestUser) {
    return this.jobs.start(bookId, 'revert', dto.baseRevision, user, dto.retry);
  }

  @Get('jobs')
  @RequirePermission(Permission.LibraryEditMetadata)
  latestJob(@Param('bookId', ParseIntPipe) bookId: number, @CurrentUser() user: RequestUser) {
    return this.jobs.latest(bookId, user);
  }

  @Get('jobs/:jobId')
  @RequirePermission(Permission.LibraryEditMetadata)
  jobStatus(@Param('bookId', ParseIntPipe) bookId: number, @Param('jobId', ParseUUIDPipe) jobId: string, @CurrentUser() user: RequestUser) {
    return this.jobs.status(bookId, jobId, user);
  }

  @Get()
  getState(@Param('bookId', ParseIntPipe) bookId: number, @CurrentUser() user: RequestUser) {
    return this.service.getState(bookId, user);
  }

  @Put()
  @RequirePermission(Permission.LibraryEditMetadata)
  @Auditable({
    action: AuditAction.BookMetadataUpdate,
    resource: AuditResource.Book,
    getResourceId: (req) => parseInt(req.params['bookId'] as string, 10),
    description: (req) => `Updated chapters for book #${req.params['bookId']}`,
  })
  save(@Param('bookId', ParseIntPipe) bookId: number, @Body() dto: SaveBookChaptersDto, @CurrentUser() user: RequestUser) {
    return this.service.save(bookId, dto, user);
  }

  @Post('revert')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.LibraryEditMetadata)
  @Auditable({
    action: AuditAction.BookMetadataUpdate,
    resource: AuditResource.Book,
    getResourceId: (req) => parseInt(req.params['bookId'] as string, 10),
    description: (req) => `Reverted chapters to the audio files for book #${req.params['bookId']}`,
  })
  revert(@Param('bookId', ParseIntPipe) bookId: number, @Body() dto: RevertBookChaptersDto, @CurrentUser() user: RequestUser) {
    return this.service.revert(bookId, dto, user);
  }

  @Post('write')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.LibraryEditMetadata)
  @Auditable({
    action: AuditAction.BookWriteAndRename,
    resource: AuditResource.Book,
    getResourceId: (req) => parseInt(req.params['bookId'] as string, 10),
    description: (req) => `Wrote chapters into the audio files of book #${req.params['bookId']}`,
  })
  writeToFiles(@Param('bookId', ParseIntPipe) bookId: number, @Body() dto: WriteBookChaptersDto, @CurrentUser() user: RequestUser) {
    return this.service.writeToFiles(bookId, dto, user);
  }

  @Get('embedded')
  @RequirePermission(Permission.LibraryEditMetadata)
  readEmbedded(@Param('bookId', ParseIntPipe) bookId: number, @CurrentUser() user: RequestUser) {
    return this.service.readEmbedded(bookId, user);
  }

  @Get('lookup')
  @RequirePermission(Permission.LibraryEditMetadata)
  lookup(@Param('bookId', ParseIntPipe) bookId: number, @Query() dto: LookupBookChaptersDto, @CurrentUser() user: RequestUser) {
    return this.service.lookup(bookId, dto, user);
  }

  @Get('ebook')
  @RequirePermission(Permission.LibraryEditMetadata)
  readEbook(@Param('bookId', ParseIntPipe) bookId: number, @Query() dto: EbookBookChaptersDto, @CurrentUser() user: RequestUser) {
    return this.service.readEbook(bookId, dto.source, user);
  }

  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.LibraryEditMetadata)
  analyze(
    @Param('bookId', ParseIntPipe) bookId: number,
    @Body() dto: AnalyzeBookChaptersDto,
    @CurrentUser() user: RequestUser,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return withRequestAbort(request, reply, (signal) => this.service.analyze(bookId, dto, user, signal));
  }

  @Get('waveform')
  @RequirePermission(Permission.LibraryEditMetadata)
  waveform(
    @Param('bookId', ParseIntPipe) bookId: number,
    @Query() dto: WaveformBookChaptersDto,
    @CurrentUser() user: RequestUser,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return withRequestAbort(request, reply, (signal) => this.service.waveform(bookId, dto, user, signal));
  }

  @Get('versions')
  @RequirePermission(Permission.LibraryEditMetadata)
  listVersions(@Param('bookId', ParseIntPipe) bookId: number, @CurrentUser() user: RequestUser) {
    return this.service.listVersions(bookId, user);
  }

  @Get('versions/:versionId')
  @RequirePermission(Permission.LibraryEditMetadata)
  getVersion(@Param('bookId', ParseIntPipe) bookId: number, @Param('versionId', ParseIntPipe) versionId: number, @CurrentUser() user: RequestUser) {
    return this.service.getVersion(bookId, versionId, user);
  }
}
