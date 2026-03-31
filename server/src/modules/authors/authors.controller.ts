import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  MessageEvent,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  Sse,
} from '@nestjs/common';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import type { FastifyReply } from 'fastify';
import { extname } from 'path';
import { map, Observable } from 'rxjs';

import { Permission, AuditAction, AuditResource } from '@projectx/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Auditable } from '../../common/decorators/auditable.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import type { AuthorMetadataCandidate } from '@projectx/types';
import { AuthorEnrichmentConfigService } from './author-enrichment-config.service';
import { AuthorAutoEnrichmentConfigDto } from './dto/author-auto-enrichment-config.dto';
import { BulkAuthorIdsDto } from './dto/bulk-author-ids.dto';
import { DeleteAuthorsDto } from './dto/delete-authors.dto';
import { ListAuthorBooksDto } from './dto/list-author-books.dto';
import { ListAuthorInsightsDto } from './dto/list-author-insights.dto';
import { ListAuthorMetadataDto } from './dto/list-author-metadata.dto';
import { ListAuthorsDto } from './dto/list-authors.dto';
import { ListDuplicateSuggestionsDto } from './dto/list-duplicate-suggestions.dto';
import { LookupAuthorMetadataDto } from './dto/lookup-author-metadata.dto';
import { MergeAuthorsDto } from './dto/merge-authors.dto';
import { PreviewAuthorEnrichmentCountDto } from './dto/preview-author-enrichment-count.dto';
import { UpdateAuthorDto } from './dto/update-author.dto';
import { AuthorsService } from './authors.service';
import { AuthorEnrichmentOrchestratorService } from './author-enrichment-orchestrator.service';
import { AuthorEnrichmentRepository } from './author-enrichment.repository';

@Controller('authors')
export class AuthorsController {
  constructor(
    private readonly authorsService: AuthorsService,
    private readonly enrichmentOrchestrator: AuthorEnrichmentOrchestratorService,
    private readonly enrichmentConfig: AuthorEnrichmentConfigService,
    private readonly queueRepo: AuthorEnrichmentRepository,
  ) {}

  @Get()
  findAll(@CurrentUser() user: RequestUser, @Query() dto: ListAuthorsDto) {
    return this.authorsService.findAll(user, dto);
  }

  @Get('insights')
  findInsights(@CurrentUser() user: RequestUser, @Query() dto: ListAuthorInsightsDto) {
    return this.authorsService.getInsights(user, dto);
  }

  @Get('suggestions/duplicates')
  findDuplicateSuggestions(@CurrentUser() user: RequestUser, @Query() dto: ListDuplicateSuggestionsDto) {
    return this.authorsService.listDuplicateSuggestions(user, dto);
  }

  @Get('metadata/providers')
  listMetadataProviders() {
    return this.authorsService.listMetadataProviders();
  }

  @Get('metadata/search')
  searchMetadata(@Query() dto: ListAuthorMetadataDto) {
    return this.authorsService.searchMetadata(dto);
  }

  @Sse('metadata/stream')
  streamMetadata(@Query() dto: ListAuthorMetadataDto): Observable<MessageEvent> {
    return this.authorsService.streamMetadata(dto).pipe(map((candidate: AuthorMetadataCandidate) => ({ data: candidate })));
  }

  @Get('metadata/lookup')
  lookupMetadata(@Query() dto: LookupAuthorMetadataDto) {
    return this.authorsService.lookupMetadata(dto);
  }

  @Post('bulk-refresh-metadata')
  @RequirePermission(Permission.LibraryEditMetadata)
  async bulkRefreshMetadata(@Body() dto: BulkAuthorIdsDto, @CurrentUser() user: RequestUser, @Res() reply: FastifyReply) {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const result = await this.authorsService.bulkRefreshMetadata(dto.authorIds, user, (event) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    reply.raw.write(`data: ${JSON.stringify({ done: true, ...result })}\n\n`);
    reply.raw.end();
  }

  @Get('enrichment/config')
  @RequirePermission(Permission.ManageMetadataConfig)
  getEnrichmentConfig() {
    return this.enrichmentConfig.getConfig();
  }

  @Put('enrichment/config')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.ManageMetadataConfig)
  @Auditable({ action: AuditAction.AuthorEnrichmentConfigUpdate, description: 'Updated author enrichment configuration' })
  async setEnrichmentConfig(@Body() config: AuthorAutoEnrichmentConfigDto) {
    await this.enrichmentConfig.setConfig(config);
    return this.enrichmentConfig.getConfig();
  }

  @Post('enrichment/preview-count')
  @RequirePermission(Permission.ManageMetadataConfig)
  async previewCount(@Body() body: PreviewAuthorEnrichmentCountDto) {
    const count = await this.queueRepo.countEligibleLinkedAuthors(body.conditions);
    return { count };
  }

  @Post('enrichment/backfill')
  @RequirePermission(Permission.ManageMetadataConfig)
  async enqueueBackfill() {
    const queued = await this.enrichmentOrchestrator.backfillLinkedAuthors();
    return { queued };
  }

  @Post('enrichment/backfill-all')
  @RequirePermission(Permission.ManageMetadataConfig)
  async enqueueBackfillAll() {
    const queued = await this.enrichmentOrchestrator.backfillAllLinkedAuthors();
    return { queued };
  }

  @Post('enrichment/pause')
  @RequirePermission(Permission.ManageMetadataConfig)
  @Auditable({ action: AuditAction.AuthorEnrichmentPause, description: 'Paused author enrichment' })
  async pauseEnrichment() {
    await this.enrichmentOrchestrator.pause();
    return { paused: true };
  }

  @Post('enrichment/resume')
  @RequirePermission(Permission.ManageMetadataConfig)
  @Auditable({ action: AuditAction.AuthorEnrichmentResume, description: 'Resumed author enrichment' })
  async resumeEnrichment() {
    await this.enrichmentOrchestrator.resume();
    return { paused: false };
  }

  @Post('enrichment/cancel')
  @RequirePermission(Permission.ManageMetadataConfig)
  @Auditable({ action: AuditAction.AuthorEnrichmentCancel, description: 'Cancelled pending author enrichment jobs' })
  async cancelEnrichment() {
    await this.enrichmentOrchestrator.cancelPending();
    return { cancelled: true };
  }

  @Post('enrichment/retry-failed')
  @RequirePermission(Permission.ManageMetadataConfig)
  async retryFailedEnrichment() {
    const requeued = await this.enrichmentOrchestrator.requeueFailed();
    return { requeued };
  }

  @Get('enrichment/failed')
  @RequirePermission(Permission.ManageMetadataConfig)
  getFailedEnrichment(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.enrichmentOrchestrator.getFailedItems(page, Math.min(limit, 100));
  }

  @Get(':id')
  findOne(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.authorsService.findOne(user, id);
  }

  @Get(':id/books')
  findBooks(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number, @Query() dto: ListAuthorBooksDto) {
    return this.authorsService.findBooks(user, id, dto);
  }

  @Get(':id/thumbnail')
  async getThumbnail(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number, @Res() reply: FastifyReply) {
    const thumbnailPath = await this.authorsService.getThumbnailPath(user, id);
    if (!thumbnailPath) {
      reply.status(404).send({ message: `No thumbnail for author ${id}` });
      return;
    }

    const { mtimeMs } = await stat(thumbnailPath);
    reply.header('Cache-Control', 'no-cache');
    reply.header('ETag', `"${Math.floor(mtimeMs)}"`);
    reply.type('image/jpeg');
    reply.send(createReadStream(thumbnailPath));
  }

  @Get(':id/image')
  async getImage(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number, @Res() reply: FastifyReply) {
    const imagePath = await this.authorsService.getImagePath(user, id);
    if (!imagePath) {
      reply.status(404).send({ message: `No image for author ${id}` });
      return;
    }

    const { mtimeMs } = await stat(imagePath);
    reply.header('Cache-Control', 'no-cache');
    reply.header('ETag', `"${Math.floor(mtimeMs)}"`);

    const ext = extname(imagePath).toLowerCase();
    reply.type(ext === '.png' ? 'image/png' : 'image/jpeg');
    reply.send(createReadStream(imagePath));
  }

  @Post(':id/enrichment/refresh')
  @RequirePermission(Permission.LibraryEditMetadata)
  refreshEnrichment(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.authorsService.refreshEnrichment(user, id);
  }

  @Patch(':id')
  @RequirePermission(Permission.LibraryEditMetadata)
  @Auditable({
    action: AuditAction.AuthorUpdate,
    resource: AuditResource.Author,
    getResourceId: (req) => parseInt(req.params['id'], 10),
    description: (req) => `Updated author #${req.params['id']}`,
  })
  update(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAuthorDto) {
    return this.authorsService.update(user, id, dto);
  }

  @Post('merge')
  @RequirePermission(Permission.LibraryEditMetadata)
  @Auditable({
    action: AuditAction.AuthorMerge,
    resource: AuditResource.Author,
    description: (req) => {
      const body = req.body as { sourceIds?: number[]; targetId?: number };
      return `Merged ${body?.sourceIds?.length ?? 0} author(s) into author #${body?.targetId ?? 'unknown'}`;
    },
  })
  merge(@CurrentUser() user: RequestUser, @Body() dto: MergeAuthorsDto) {
    return this.authorsService.merge(user, dto);
  }

  @Delete()
  @RequirePermission(Permission.LibraryEditMetadata)
  @Auditable({
    action: AuditAction.AuthorDelete,
    resource: AuditResource.Author,
    description: (req) => {
      const count = (req.body as { authorIds?: number[] })?.authorIds?.length ?? 0;
      return `Deleted ${count} author${count !== 1 ? 's' : ''}`;
    },
  })
  delete(@CurrentUser() user: RequestUser, @Body() dto: DeleteAuthorsDto) {
    return this.authorsService.delete(user, dto);
  }
}
