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
import { Permission } from '@projectx/types';
import type { BookBucketMetadata } from '@projectx/types';

import { AuditAction, AuditResource } from '@projectx/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Auditable } from '../../common/decorators/auditable.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { imageContentTypeFromPath } from '../../common/image-content-type';
import type { MultipartRequest } from '../../common/types/multipart-request';
import type { RequestUser } from '../../common/types/request-user';
import { BookBucketService } from './book-bucket.service';
import { BookBucketIngestService } from './book-bucket-ingest.service';
import { BookBucketFinalizeService } from './book-bucket-finalize.service';
import { BookBucketWatcherService } from './book-bucket-watcher.service';
import { BookBucketRepository } from './book-bucket.repository';
import { ListBookBucketFilesDto } from './dto/list-book-bucket-files.dto';
import {
  UpdateBookBucketFileDto,
  FinalizeBookBucketDto,
  BulkDiscardDto,
  BulkEditBookBucketDto,
  BulkApplyFetchedDto,
  BulkRetryFetchDto,
  BulkSetTargetDto,
  PreviewNamesDto,
  SelectionSummaryDto,
} from './dto/index';
import { MAX_UPLOAD_BYTES } from '../upload/upload-storage.service';

@Controller('book-bucket')
@RequirePermission(Permission.BookBucketAccess)
export class BookBucketController {
  constructor(
    private readonly service: BookBucketService,
    private readonly ingestService: BookBucketIngestService,
    private readonly finalizeService: BookBucketFinalizeService,
    private readonly watcherService: BookBucketWatcherService,
    private readonly repo: BookBucketRepository,
  ) {}

  @Get('files')
  listFiles(@CurrentUser() user: RequestUser, @Query() query: ListBookBucketFilesDto) {
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
    const data = await req.file({ limits: { fileSize: MAX_UPLOAD_BYTES } });
    if (!data) throw new BadRequestException('No file provided');

    const fileId = await this.ingestService.ingestUpload(data.filename, data.file as unknown as Readable, user.id);
    return this.service.getFile(fileId);
  }

  @Patch('files/:id')
  updateFile(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBookBucketFileDto) {
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
  bulkEdit(@CurrentUser() user: RequestUser, @Body() dto: BulkEditBookBucketDto) {
    return this.service.bulkEdit(
      dto.fileIds,
      dto.selectAll,
      dto.excludedIds,
      dto.fields as Partial<BookBucketMetadata & Record<string, unknown>>,
      dto.enabledFields,
      dto.mergeArrays,
      dto.status,
      dto.search,
      user.id,
      user.isSuperuser,
    );
  }

  @Post('files/preview-names')
  previewNames(@Body() dto: PreviewNamesDto) {
    return this.finalizeService.previewNames(dto.fileIds, dto.selectAll, dto.excludedIds, dto.defaultLibraryId, dto.status, dto.search);
  }

  @Post('finalize')
  @Auditable({
    action: AuditAction.BookBucketFinalize,
    resource: AuditResource.BookBucketFile,
    description: (req) => {
      const body = req.body as { fileIds?: number[]; selectAll?: boolean };
      if (body?.selectAll) return 'Finalized all Book Bucket files into library';
      const count = body?.fileIds?.length ?? 0;
      return `Finalized ${count} Book Bucket file${count !== 1 ? 's' : ''} into library`;
    },
  })
  finalize(@CurrentUser() user: RequestUser, @Body() dto: FinalizeBookBucketDto) {
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
