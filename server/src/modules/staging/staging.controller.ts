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
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { StagingMetadata } from '@projectx/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { StagingService } from './staging.service';
import { StagingIngestService } from './staging-ingest.service';
import { StagingFinalizeService } from './staging-finalize.service';
import { StagingWatcherService } from './staging-watcher.service';
import { StagingRepository } from './staging.repository';
import { ListStagingFilesDto } from './dto/list-staging-files.dto';
import {
  UpdateStagingFileDto,
  FinalizeStagingDto,
  BulkDiscardDto,
  BulkEditStagingDto,
  BulkApplyFetchedDto,
  BulkRetryFetchDto,
  PreviewNamesDto,
} from './dto/index';
import { MAX_UPLOAD_BYTES } from '../upload/upload-storage.service';

type MultipartRequest = FastifyRequest & {
  file: (opts?: object) => Promise<{ filename: string; file: NodeJS.ReadableStream } | undefined>;
};

@Controller('staging')
@RequirePermission('staging_access')
export class StagingController {
  constructor(
    private readonly service: StagingService,
    private readonly ingestService: StagingIngestService,
    private readonly finalizeService: StagingFinalizeService,
    private readonly watcherService: StagingWatcherService,
    private readonly repo: StagingRepository,
  ) {}

  @Get('files')
  listFiles(@Query() query: ListStagingFilesDto) {
    return this.service.listFiles({
      status: query.status,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      sort: query.sort ?? 'createdAt',
      order: query.order ?? 'desc',
      search: query.search,
    });
  }

  @Get('summary')
  getSummary() {
    return this.service.getSummary();
  }

  @Get('statistics')
  getStatistics() {
    return this.service.getStatistics();
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
    const contentType = row.coverPath.endsWith('.png') ? 'image/png' : 'image/jpeg';
    reply.header('Content-Type', contentType);
    reply.header('Cache-Control', 'private, max-age=3600');
    return reply.send(stream);
  }

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  async upload(@Req() req: MultipartRequest) {
    const data = await req.file({ limits: { fileSize: MAX_UPLOAD_BYTES } });
    if (!data) throw new BadRequestException('No file provided');

    const fileId = await this.ingestService.ingestUpload(data.filename, data.file as unknown as Readable);
    return this.service.getFile(fileId);
  }

  @Patch('files/:id')
  updateFile(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateStagingFileDto) {
    return this.service.updateFile(id, dto);
  }

  @Delete('files/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  discardFile(@Param('id', ParseIntPipe) id: number) {
    return this.service.discardFile(id);
  }

  @Post('files/discard')
  @HttpCode(HttpStatus.NO_CONTENT)
  bulkDiscard(@Body() dto: BulkDiscardDto) {
    return this.service.bulkDiscard(dto.fileIds ?? [], dto.selectAll, dto.excludedIds);
  }

  @Post('files/apply-fetched')
  applyFetched(@Body() dto: BulkApplyFetchedDto) {
    return this.service.bulkApplyFetched(dto.fileIds ?? [], dto.selectAll, dto.excludedIds);
  }

  @Post('files/retry-fetch')
  retryFetch(@Body() dto: BulkRetryFetchDto) {
    return this.service.bulkRetryFetch(dto.fileIds, dto.selectAll, dto.excludedIds);
  }

  @Post('files/bulk-edit')
  bulkEdit(@Body() dto: BulkEditStagingDto) {
    return this.service.bulkEdit(
      dto.fileIds,
      dto.selectAll,
      dto.excludedIds,
      dto.fields as Partial<StagingMetadata & Record<string, unknown>>,
      dto.enabledFields,
      dto.mergeArrays,
    );
  }

  @Post('files/preview-names')
  previewNames(@Body() dto: PreviewNamesDto) {
    return this.finalizeService.previewNames(dto.fileIds, dto.selectAll, dto.excludedIds, dto.defaultLibraryId);
  }

  @Post('finalize')
  finalize(@CurrentUser() user: RequestUser, @Body() dto: FinalizeStagingDto) {
    const isSuperuser = user.roles.some((r) => r.isSuperuser);
    return this.finalizeService.finalize(
      user.id,
      isSuperuser,
      dto.fileIds,
      dto.selectAll,
      dto.excludedIds,
      dto.defaultLibraryId,
      dto.defaultFolderId,
      dto.overrides,
    );
  }

  @Post('rescan')
  @HttpCode(HttpStatus.NO_CONTENT)
  rescan() {
    return this.watcherService.rescan();
  }
}
