import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { createReadStream } from 'fs';
import { access } from 'fs/promises';
import { Readable } from 'stream';
import type { FastifyReply } from 'fastify';
import { Permission } from '@bookorbit/types';
import type { BookDockMetadata } from '@bookorbit/types';

import { AuditAction, AuditResource } from '@bookorbit/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Auditable } from '../../common/decorators/auditable.decorator';
import { ForbidPermission } from '../../common/decorators/forbid-permission.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { imageContentTypeFromPath } from '../../common/image-content-type';
import type { MultipartRequest } from '../../common/types/multipart-request';
import type { RequestUser } from '../../common/types/request-user';
import { BookDockService } from './book-dock.service';
import { BookDockIngestService } from './book-dock-ingest.service';
import { BookDockFinalizeService } from './book-dock-finalize.service';
import { BookDockWatcherService } from './book-dock-watcher.service';
import { BookDockRepository } from './book-dock.repository';
import { ListBookDockFilesDto } from './dto/list-book-dock-files.dto';
import {
  UpdateBookDockFileDto,
  FinalizeBookDockDto,
  BulkDiscardDto,
  BulkEditBookDockDto,
  BulkApplyFetchedDto,
  BulkRetryFetchDto,
  BulkSetTargetDto,
  PreviewNamesDto,
  SelectionSummaryDto,
} from './dto/index';
import { AppSettingsService } from '../app-settings/app-settings.service';

@Controller('book-dock')
@RequirePermission(Permission.BookDockAccess)
export class BookDockController {
  constructor(
    private readonly service: BookDockService,
    private readonly ingestService: BookDockIngestService,
    private readonly finalizeService: BookDockFinalizeService,
    private readonly watcherService: BookDockWatcherService,
    private readonly repo: BookDockRepository,
    private readonly appSettings: AppSettingsService,
  ) {}

  @Get('files')
  listFiles(@CurrentUser() user: RequestUser, @Query() query: ListBookDockFilesDto) {
    return this.service.listFiles({
      status: query.status,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      sort: query.sort ?? 'createdAt',
      order: query.order ?? 'desc',
      search: query.search,
      userId: user.id,
      isSuperuser: user.isSuperuser,
    });
  }

  @Get('summary')
  getSummary(@CurrentUser() user: RequestUser) {
    return this.service.getSummary(user.id, user.isSuperuser);
  }

  @Post('pause')
  @HttpCode(HttpStatus.OK)
  pause() {
    return this.service.pauseProcessing();
  }

  @Post('resume')
  @HttpCode(HttpStatus.OK)
  resume() {
    return this.service.resumeProcessing();
  }

  @Get('statistics')
  getStatistics(@CurrentUser() user: RequestUser) {
    return this.service.getStatistics(user.id, user.isSuperuser);
  }

  @Get('files/:id')
  getFile(@Param('id', ParseIntPipe) id: number) {
    return this.service.getFile(id);
  }

  @Get('files/:id/cover')
  async getCover(@Param('id', ParseIntPipe) id: number, @Res() reply: FastifyReply) {
    const row = await this.repo.findById(id);
    if (!row?.coverPath) throw new NotFoundException('No cover available');

    const exists = await access(row.coverPath)
      .then(() => true)
      .catch(() => false);
    if (!exists) throw new NotFoundException('Cover file not found on disk');

    const stream = createReadStream(row.coverPath);
    const contentType = imageContentTypeFromPath(row.coverPath);
    reply.header('Content-Type', contentType);
    reply.header('Cache-Control', 'private, max-age=3600');
    return reply.send(stream);
  }

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  async upload(@CurrentUser() user: RequestUser, @Req() req: MultipartRequest) {
    const limitMb = await this.appSettings.getMaxUploadSizeMb();
    const data = await req.file({ limits: { fileSize: limitMb * 1024 * 1024 } });
    if (!data) throw new BadRequestException('No file provided');

    const fileId = await this.ingestService.ingestUpload(data.filename, data.file as unknown as Readable, user.id);
    return this.service.getFile(fileId);
  }

  @Patch('files/:id')
  updateFile(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBookDockFileDto) {
    return this.service.updateFile(id, dto);
  }

  @Delete('files/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  discardFile(@Param('id', ParseIntPipe) id: number) {
    return this.service.discardFile(id);
  }

  @Post('files/discard')
  @HttpCode(HttpStatus.NO_CONTENT)
  bulkDiscard(@CurrentUser() user: RequestUser, @Body() dto: BulkDiscardDto) {
    return this.service.bulkDiscard(dto.fileIds ?? [], dto.selectAll, dto.excludedIds, dto.status, dto.search, user.id, user.isSuperuser);
  }

  @Post('files/apply-fetched')
  applyFetched(@CurrentUser() user: RequestUser, @Body() dto: BulkApplyFetchedDto) {
    return this.service.bulkApplyFetched(dto.fileIds ?? [], dto.selectAll, dto.excludedIds, dto.status, dto.search, user.id, user.isSuperuser);
  }

  @Post('files/retry-fetch')
  retryFetch(@CurrentUser() user: RequestUser, @Body() dto: BulkRetryFetchDto) {
    return this.service.bulkRetryFetch(dto.fileIds, dto.selectAll, dto.excludedIds, dto.status, dto.search, user.id, user.isSuperuser);
  }

  @Post('files/set-target')
  setTarget(@CurrentUser() user: RequestUser, @Body() dto: BulkSetTargetDto) {
    return this.service.bulkSetTarget(
      dto.fileIds ?? [],
      dto.selectAll,
      dto.excludedIds,
      dto.targetLibraryId ?? null,
      dto.targetFolderId ?? null,
      dto.status,
      dto.search,
      user.id,
      user.isSuperuser,
    );
  }

  @Post('files/selection-summary')
  selectionSummary(@CurrentUser() user: RequestUser, @Body() dto: SelectionSummaryDto) {
    return this.service.selectionSummary(dto.fileIds ?? [], dto.selectAll, dto.excludedIds, dto.status, dto.search, user.id, user.isSuperuser);
  }

  @Post('files/bulk-edit')
  @ForbidPermission(Permission.DemoRestricted, 'Demo-restricted account cannot perform bulk edits')
  bulkEdit(@CurrentUser() user: RequestUser, @Body() dto: BulkEditBookDockDto) {
    return this.service.bulkEdit(
      dto.fileIds,
      dto.selectAll,
      dto.excludedIds,
      dto.fields as Partial<BookDockMetadata & Record<string, unknown>>,
      dto.enabledFields,
      dto.mergeArrays,
      dto.status,
      dto.search,
      user.id,
      user.isSuperuser,
    );
  }

  @Post('files/preview-names')
  previewNames(@CurrentUser() user: RequestUser, @Body() dto: PreviewNamesDto) {
    return this.finalizeService.previewNames(
      dto.fileIds,
      dto.selectAll,
      dto.excludedIds,
      dto.defaultLibraryId,
      user.id,
      user.isSuperuser,
      dto.status,
      dto.search,
    );
  }

  @Post('finalize/preview')
  @HttpCode(HttpStatus.OK)
  previewFinalize(@CurrentUser() user: RequestUser, @Body() dto: FinalizeBookDockDto) {
    return this.finalizeService.previewFinalize(
      user.id,
      user.isSuperuser,
      dto.fileIds,
      dto.selectAll,
      dto.excludedIds,
      dto.defaultLibraryId,
      dto.defaultFolderId,
      dto.overrides,
      dto.status,
      dto.search,
    );
  }

  @Post('finalize/discard-duplicates')
  @HttpCode(HttpStatus.OK)
  discardFinalizeDuplicates(@CurrentUser() user: RequestUser, @Body() dto: FinalizeBookDockDto) {
    return this.finalizeService.discardDuplicateCandidates(
      user.id,
      user.isSuperuser,
      dto.fileIds,
      dto.selectAll,
      dto.excludedIds,
      dto.defaultLibraryId,
      dto.defaultFolderId,
      dto.overrides,
      dto.status,
      dto.search,
    );
  }

  @Post('finalize')
  @Auditable({
    action: AuditAction.BookDockFinalize,
    resource: AuditResource.BookDockFile,
    description: (req) => {
      const body = req.body as { fileIds?: number[]; selectAll?: boolean };
      if (body?.selectAll) return 'Finalized all Book Dock files into library';
      const count = body?.fileIds?.length ?? 0;
      return `Finalized ${count} Book Dock file${count !== 1 ? 's' : ''} into library`;
    },
  })
  finalize(@CurrentUser() user: RequestUser, @Body() dto: FinalizeBookDockDto) {
    const isSuperuser = user.isSuperuser;
    return this.finalizeService.finalize(
      user.id,
      isSuperuser,
      dto.fileIds,
      dto.selectAll,
      dto.excludedIds,
      dto.defaultLibraryId,
      dto.defaultFolderId,
      dto.overrides,
      dto.status,
      dto.search,
    );
  }

  @Post('rescan')
  @HttpCode(HttpStatus.NO_CONTENT)
  rescan() {
    return this.watcherService.rescan();
  }
}
