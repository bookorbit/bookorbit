import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  MessageEvent,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  Sse,
  UseGuards,
} from '@nestjs/common';
import type { FileHandle } from 'fs/promises';
import { Readable } from 'stream';
import type { FastifyReply } from 'fastify';
import { RouteConfig } from '@nestjs/platform-fastify';
import { Observable } from 'rxjs';

import { AuditAction, AuditResource, Permission, PODCAST_OPML_OMITTED_HEADER } from '@bookorbit/types';
import type {
  PodcastArtworkResult,
  PodcastBulkActionResult,
  PodcastBulkPurgePreview,
  PodcastDownloadBatch,
  PodcastDirectoryResult,
  PodcastArchiveResult,
  PodcastBookmark,
  PodcastCreateResult,
  PodcastEpisodeListItem,
  PodcastEpisodePage,
  PodcastEpisodeStateRow,
  PodcastEpisodeSummary,
  PodcastFeedHealth,
  PodcastFeedPreview,
  PodcastFollowState,
  PodcastLibrarySettings,
  PodcastListItem,
  PodcastImportScanStatus,
  PodcastJobSummary,
  PodcastJobState,
  PodcastLibraryActivity,
  PodcastPage,
  PodcastQueuePage,
  PodcastStreamTicket,
  PodcastSummary,
} from '@bookorbit/types';
import { Auditable } from '../../common/decorators/auditable.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequireLibraryAccess } from '../../common/decorators/require-library-access.decorator';
import { RequireLibraryType } from '../../common/decorators/require-library-type.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { contentDispositionHeader } from '../../common/utils/content-disposition.utils';
import type { MultipartRequest } from '../../common/types/multipart-request';
import type { RequestUser } from '../../common/types/request-user';
import {
  BulkDeletePodcastShowsDto,
  CreatePodcastBookmarkDto,
  CreatePodcastDto,
  CreatePodcastSessionDto,
  DownloadLatestPodcastEpisodesDto,
  ExportPodcastOpmlDto,
  FollowPodcastDto,
  ListPodcastContinueDto,
  ListPodcastEpisodesDto,
  ListPodcastQueueDto,
  ListPodcastShowsDto,
  MovePodcastQueueDto,
  PodcastPageQueryDto,
  PodcastEpisodeStateBatchDto,
  PodcastFeedUrlDto,
  PodcastImportScanDto,
  PodcastMergeDto,
  PodcastOpmlImportDto,
  QueuePodcastEpisodeDto,
  QueuePodcastEpisodesDto,
  ReorderPodcastQueueDto,
  RestorePodcastQueueDto,
  SearchPodcastDirectoryDto,
  UpdateEpisodeStateDto,
  UpdatePodcastBookmarkDto,
  UpdatePodcastConfigDto,
  UpdatePodcastEpisodeMetadataDto,
  UpdatePodcastMetadataDto,
  UpdatePodcastLibrarySettingsDto,
  UploadPodcastArtworkFromUrlDto,
} from './dto/podcast.dto';
import { PodcastArtworkService } from './podcast-artwork.service';
import { PodcastEventsService } from './podcast-events.service';
import { PodcastMediaStorageService } from './podcast-media-storage.service';
import { PodcastAccessService } from './podcast-access.service';
import { PodcastCatalogService } from './podcast-catalog.service';
import { PodcastOperationsService } from './podcast-operations.service';
import { PodcastPlaybackService } from './podcast-playback.service';
import { PodcastStreamAuthGuard } from './podcast-stream-auth.guard';
import { PodcastStreamTicketService } from './podcast-stream-ticket.service';
import { parsePodcastByteRange } from './podcast-range.utils';

@Controller('podcast-libraries')
@RequireLibraryType('podcasts')
export class PodcastLibraryController {
  constructor(
    private readonly catalog: PodcastCatalogService,
    private readonly playback: PodcastPlaybackService,
    private readonly operations: PodcastOperationsService,
  ) {}

  @Get(':libraryId/podcasts')
  @RequireLibraryAccess('viewer')
  listPodcasts(
    @Param('libraryId', ParseIntPipe) libraryId: number,
    @Query() query: ListPodcastShowsDto,
    @CurrentUser() user: RequestUser,
  ): Promise<PodcastPage<PodcastListItem>> {
    return this.catalog.listPodcasts(libraryId, user.id, query);
  }

  @Get(':libraryId/episodes')
  @RequireLibraryAccess('viewer')
  listEpisodes(
    @Param('libraryId', ParseIntPipe) libraryId: number,
    @Query() query: ListPodcastEpisodesDto,
    @CurrentUser() user: RequestUser,
  ): Promise<PodcastEpisodePage> {
    return this.catalog.listEpisodes(libraryId, user.id, query);
  }

  @Post(':libraryId/queue-episodes')
  @RequireLibraryAccess('viewer')
  queueEpisodes(
    @Param('libraryId', ParseIntPipe) libraryId: number,
    @Body() dto: QueuePodcastEpisodesDto,
    @CurrentUser() user: RequestUser,
  ): Promise<PodcastBulkActionResult> {
    return this.playback.queueEpisodesFromRules(libraryId, user, dto);
  }

  @Post(':libraryId/feed-preview')
  @RequireLibraryAccess('editor')
  @RequirePermission(Permission.PodcastManageFeeds)
  previewFeed(@Param('libraryId', ParseIntPipe) libraryId: number, @Body() dto: PodcastFeedUrlDto): Promise<PodcastFeedPreview> {
    return this.catalog.previewFeed(libraryId, dto.feedUrl);
  }

  /**
   * The one way a show enters the library, from either direction: `source: 'feed'` subscribes to an
   * address, `source: 'folder'` adopts audio the user already placed in the library folder. Both
   * are acquisition, so both sit behind the same gate.
   */
  @Post(':libraryId/podcasts')
  @RequireLibraryAccess('editor')
  @RequirePermission(Permission.PodcastManageFeeds)
  @Auditable({
    action: AuditAction.PodcastCreate,
    resource: AuditResource.Podcast,
    getResourceId: (_, response) => (response as { id?: number })?.id,
    description: (_, response) => `Added podcast '${(response as { title?: string })?.title ?? 'unknown'}'`,
  })
  createPodcast(
    @Param('libraryId', ParseIntPipe) libraryId: number,
    @Body() dto: CreatePodcastDto,
    @CurrentUser() user: RequestUser,
  ): Promise<PodcastCreateResult> {
    return this.catalog.createPodcast(libraryId, dto, user);
  }

  @Post(':libraryId/opml/import')
  @RouteConfig({ bodyLimit: 6 * 1024 * 1024 })
  @RequireLibraryAccess('editor')
  @RequirePermission(Permission.PodcastManageFeeds)
  @Auditable({ action: AuditAction.PodcastOpmlImport, resource: AuditResource.Library, description: 'Queued podcast OPML import' })
  importOpml(@Param('libraryId', ParseIntPipe) libraryId: number, @Body() dto: PodcastOpmlImportDto, @CurrentUser() user: RequestUser) {
    return this.operations.importOpml(libraryId, dto, user);
  }

  /**
   * Adopts audio the user already placed inside the library folder. Same gate as adding a feed:
   * importing is acquisition, and the run can only ever attach files to shows already subscribed.
   */
  @Post(':libraryId/import-scan')
  @RequireLibraryAccess('editor')
  @RequirePermission(Permission.PodcastManageFeeds)
  @Auditable({ action: AuditAction.PodcastOpmlImport, resource: AuditResource.Library, description: 'Queued podcast local file import' })
  importLocalFiles(@Param('libraryId', ParseIntPipe) libraryId: number, @Body() dto: PodcastImportScanDto, @CurrentUser() user: RequestUser) {
    return this.operations.enqueueImportScan(libraryId, dto, user);
  }

  @Get(':libraryId/import-scan/latest')
  @RequireLibraryAccess('editor')
  @RequirePermission(Permission.PodcastManageFeeds)
  getLatestImportScan(@Param('libraryId', ParseIntPipe) libraryId: number): Promise<PodcastImportScanStatus> {
    return this.operations.getLatestImportScan(libraryId);
  }

  /** A read, but the selection travels in a body: an id list long enough to matter does not fit a query string. */
  @Post(':libraryId/shows/bulk-purge-preview')
  @HttpCode(HttpStatus.OK)
  @RequireLibraryAccess('owner')
  @RequirePermission(Permission.PodcastPurge)
  previewBulkDelete(
    @Param('libraryId', ParseIntPipe) libraryId: number,
    @Body() dto: BulkDeletePodcastShowsDto,
    @CurrentUser() user: RequestUser,
  ): Promise<PodcastBulkPurgePreview> {
    return this.operations.getBulkPurgePreview(libraryId, dto.podcastIds, user);
  }

  @Post(':libraryId/shows/bulk-delete')
  @RequireLibraryAccess('owner')
  @RequirePermission(Permission.PodcastPurge)
  @Auditable({ action: AuditAction.PodcastPurge, resource: AuditResource.Library, description: 'Queued permanent delete of selected podcasts' })
  bulkDelete(
    @Param('libraryId', ParseIntPipe) libraryId: number,
    @Body() dto: BulkDeletePodcastShowsDto,
    @CurrentUser() user: RequestUser,
  ): Promise<PodcastBulkActionResult> {
    return this.operations.bulkDeleteShows(libraryId, dto.podcastIds, user);
  }

  @Get(':libraryId/opml/export')
  @RequireLibraryAccess('owner')
  @RequirePermission(Permission.PodcastManageFeeds)
  @Auditable({ action: AuditAction.PodcastOpmlExport, resource: AuditResource.Library, description: 'Exported podcast OPML' })
  async exportOpml(@Param('libraryId', ParseIntPipe) libraryId: number, @Query() query: ExportPodcastOpmlDto, @Res() reply: FastifyReply) {
    const { content, omittedLocalShows } = await this.catalog.exportOpml(libraryId, query.includePrivate, query.includeArchived);
    reply.type('text/x-opml; charset=utf-8');
    reply.header('Content-Disposition', contentDispositionHeader('attachment', 'podcasts.opml', 'podcasts.opml'));
    // OPML has no way to describe a show without a feed, so the ones left out are counted here.
    reply.header(PODCAST_OPML_OMITTED_HEADER, String(omittedLocalShows));
    reply.send(Readable.from(content));
  }

  @Get(':libraryId/settings')
  @RequireLibraryAccess('viewer')
  getSettings(@Param('libraryId', ParseIntPipe) libraryId: number): Promise<PodcastLibrarySettings> {
    return this.catalog.getLibrarySettings(libraryId);
  }

  @Patch(':libraryId/settings')
  @RequireLibraryAccess('owner')
  @RequirePermission(Permission.PodcastManageRetention)
  @Auditable({ action: AuditAction.PodcastRetentionUpdate, resource: AuditResource.Library, description: 'Updated podcast retention settings' })
  updateSettings(@Param('libraryId', ParseIntPipe) libraryId: number, @Body() dto: UpdatePodcastLibrarySettingsDto): Promise<PodcastLibrarySettings> {
    return this.catalog.updateLibrarySettings(libraryId, dto);
  }

  /** Health only ever reports on live feeds, so it takes the plain page query rather than the archivable show query. */
  @Get(':libraryId/health')
  @RequireLibraryAccess('editor')
  @RequirePermission(Permission.PodcastManageFeeds)
  getHealth(@Param('libraryId', ParseIntPipe) libraryId: number, @Query() query: PodcastPageQueryDto): Promise<PodcastPage<PodcastFeedHealth>> {
    return this.catalog.listFeedHealth(libraryId, query);
  }

  @Get(':libraryId/jobs')
  @RequireLibraryAccess('editor')
  @RequirePermission(Permission.PodcastManageFeeds)
  getJobs(@Param('libraryId', ParseIntPipe) libraryId: number, @Query('type') type?: string): Promise<PodcastJobSummary> {
    return this.operations.getJobSummary(libraryId, type);
  }

  /**
   * One job, by the id its enqueueing route returned. The summary above is library-wide, so a
   * client waiting on its own work could not tell the difference between that work still running
   * and anything else in the library running.
   */
  @Get(':libraryId/jobs/:jobId')
  @RequireLibraryAccess('editor')
  @RequirePermission(Permission.PodcastManageFeeds)
  getJob(@Param('libraryId', ParseIntPipe) libraryId: number, @Param('jobId', ParseIntPipe) jobId: number): Promise<PodcastJobState> {
    return this.operations.getJobState(libraryId, jobId);
  }

  /**
   * The whole library status strip in one poll, replacing separate job, import, download and health
   * requests. Counters only; each detail payload stays on the endpoint a user opens deliberately.
   */
  @Get(':libraryId/activity')
  @RequireLibraryAccess('editor')
  @RequirePermission(Permission.PodcastManageFeeds)
  getActivity(@Param('libraryId', ParseIntPipe) libraryId: number, @CurrentUser() user: RequestUser): Promise<PodcastLibraryActivity> {
    return this.operations.getLibraryActivity(libraryId, user);
  }
}

/**
 * Directory discovery. Deliberately outside `podcast-libraries` because the open directory is
 * not scoped to a library; the service applies the equivalent editor gate itself.
 */
@Controller('podcast-search')
export class PodcastSearchController {
  constructor(private readonly catalog: PodcastCatalogService) {}

  @Get()
  @RequirePermission(Permission.PodcastManageFeeds)
  search(@Query() query: SearchPodcastDirectoryDto, @CurrentUser() user: RequestUser): Promise<PodcastDirectoryResult[]> {
    return this.catalog.searchDirectory(user, query);
  }
}

/**
 * The realtime channel for clients that cannot speak Engine.IO. Ordinary JWT auth over ordinary
 * HTTP, carrying the gateway's own events filtered to the libraries this user can reach.
 */
@Controller('podcast-events')
export class PodcastEventsController {
  constructor(private readonly events: PodcastEventsService) {}

  @Sse('stream')
  stream(@CurrentUser() user: RequestUser): Observable<MessageEvent> {
    return this.events.stream(user);
  }
}

@Controller('podcasts')
export class PodcastController {
  constructor(
    private readonly catalog: PodcastCatalogService,
    private readonly playback: PodcastPlaybackService,
    private readonly operations: PodcastOperationsService,
    private readonly access: PodcastAccessService,
    private readonly artworkService: PodcastArtworkService,
  ) {}

  @Get(':podcastId')
  getPodcast(@Param('podcastId', ParseIntPipe) podcastId: number, @CurrentUser() user: RequestUser): Promise<PodcastSummary> {
    return this.catalog.getPodcast(podcastId, user);
  }

  @Patch(':podcastId/config')
  @RequirePermission(Permission.PodcastManageFeeds)
  @Auditable({
    action: AuditAction.PodcastUpdate,
    resource: AuditResource.Podcast,
    getResourceId: (request) => Number(request.params['podcastId']),
    description: 'Updated podcast feed configuration',
  })
  updateConfig(@Param('podcastId', ParseIntPipe) podcastId: number, @Body() dto: UpdatePodcastConfigDto, @CurrentUser() user: RequestUser) {
    return this.catalog.updatePodcastConfig(podcastId, dto, user);
  }

  @Patch(':podcastId/metadata')
  @RequirePermission(Permission.PodcastEditMetadata)
  @Auditable({
    action: AuditAction.PodcastUpdate,
    resource: AuditResource.Podcast,
    getResourceId: (request) => Number(request.params['podcastId']),
    description: 'Updated podcast metadata',
  })
  updateMetadata(@Param('podcastId', ParseIntPipe) podcastId: number, @Body() dto: UpdatePodcastMetadataDto, @CurrentUser() user: RequestUser) {
    return this.catalog.updatePodcastMetadata(podcastId, dto, user);
  }

  @Post(':podcastId/refresh')
  @RequirePermission(Permission.PodcastManageFeeds)
  refresh(@Param('podcastId', ParseIntPipe) podcastId: number, @CurrentUser() user: RequestUser): Promise<{ jobId: number | null }> {
    return this.operations.enqueueRefresh(podcastId, user);
  }

  @Post(':podcastId/reparse')
  @RequirePermission(Permission.PodcastManageFeeds)
  reparse(@Param('podcastId', ParseIntPipe) podcastId: number, @CurrentUser() user: RequestUser): Promise<{ jobId: number | null }> {
    return this.operations.enqueueReparse(podcastId, user);
  }

  @Post(':podcastId/archive')
  @RequirePermission(Permission.PodcastManageFeeds)
  @Auditable({ action: AuditAction.PodcastArchive, resource: AuditResource.Podcast, description: 'Archived podcast' })
  archive(@Param('podcastId', ParseIntPipe) podcastId: number, @CurrentUser() user: RequestUser): Promise<PodcastArchiveResult> {
    return this.catalog.archivePodcast(podcastId, user, true);
  }

  @Post(':podcastId/restore')
  @RequirePermission(Permission.PodcastManageFeeds)
  @Auditable({ action: AuditAction.PodcastRestore, resource: AuditResource.Podcast, description: 'Restored podcast' })
  restore(@Param('podcastId', ParseIntPipe) podcastId: number, @CurrentUser() user: RequestUser): Promise<PodcastArchiveResult> {
    return this.catalog.archivePodcast(podcastId, user, false);
  }

  @Get(':podcastId/purge-preview')
  @RequirePermission(Permission.PodcastPurge)
  purgePreview(@Param('podcastId', ParseIntPipe) podcastId: number, @CurrentUser() user: RequestUser) {
    return this.operations.getPurgePreview(podcastId, user);
  }

  @Post(':podcastId/purge')
  @RequirePermission(Permission.PodcastPurge)
  @Auditable({ action: AuditAction.PodcastPurge, resource: AuditResource.Podcast, description: 'Queued permanent podcast purge' })
  purge(@Param('podcastId', ParseIntPipe) podcastId: number, @CurrentUser() user: RequestUser) {
    return this.operations.enqueuePurge(podcastId, user);
  }

  @Post(':podcastId/merge')
  @RequirePermission(Permission.PodcastPurge)
  @Auditable({ action: AuditAction.PodcastMerge, resource: AuditResource.Podcast, description: 'Queued podcast merge' })
  merge(@Param('podcastId', ParseIntPipe) podcastId: number, @Body() dto: PodcastMergeDto, @CurrentUser() user: RequestUser) {
    return this.operations.enqueueMerge(podcastId, dto.sourcePodcastId, user);
  }

  @Post(':podcastId/follow')
  follow(
    @Param('podcastId', ParseIntPipe) podcastId: number,
    @Body() dto: FollowPodcastDto,
    @CurrentUser() user: RequestUser,
  ): Promise<PodcastFollowState> {
    return this.catalog.followPodcast(podcastId, user, dto);
  }

  @Delete(':podcastId/follow')
  @HttpCode(HttpStatus.NO_CONTENT)
  unfollow(@Param('podcastId', ParseIntPipe) podcastId: number, @CurrentUser() user: RequestUser): Promise<void> {
    return this.catalog.unfollowPodcast(podcastId, user);
  }

  @Post(':podcastId/queue-all')
  queueAll(@Param('podcastId', ParseIntPipe) podcastId: number, @CurrentUser() user: RequestUser): Promise<PodcastBulkActionResult> {
    return this.playback.queueAllPodcastEpisodes(podcastId, user);
  }

  @Post(':podcastId/mark-all-played')
  markAllPlayed(@Param('podcastId', ParseIntPipe) podcastId: number, @CurrentUser() user: RequestUser): Promise<PodcastBulkActionResult> {
    return this.playback.markAllPodcastEpisodesPlayed(podcastId, user);
  }

  @Post(':podcastId/download-latest')
  @RequirePermission(Permission.PodcastDownload)
  @Auditable({ action: AuditAction.PodcastDownload, resource: AuditResource.Podcast, description: 'Queued latest podcast episode downloads' })
  downloadLatest(
    @Param('podcastId', ParseIntPipe) podcastId: number,
    @Body() dto: DownloadLatestPodcastEpisodesDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.operations.downloadLatestPodcastEpisodes(podcastId, dto, user);
  }

  @Delete(':podcastId/downloads')
  @RequirePermission(Permission.PodcastDownload)
  @Auditable({ action: AuditAction.PodcastDownloadRemove, resource: AuditResource.Podcast, description: 'Removed all podcast downloads' })
  removeAllDownloads(@Param('podcastId', ParseIntPipe) podcastId: number, @CurrentUser() user: RequestUser): Promise<PodcastBulkActionResult> {
    return this.operations.removeAllPodcastDownloads(podcastId, user);
  }

  @Get(':podcastId/artwork')
  async artwork(
    @Param('podcastId', ParseIntPipe) podcastId: number,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @CurrentUser() user: RequestUser,
    @Res() reply: FastifyReply,
  ) {
    await this.access.requirePodcastAccess(podcastId, user);
    const artwork = await this.artworkService.resolveArtwork(podcastId, ifNoneMatch);
    // Revalidation is now a single row read, so the window can be long without pinning a stale
    // image: a feed swapping its artwork changes the source URL, and so changes the ETag.
    reply.header('Cache-Control', 'private, max-age=86400').header('ETag', artwork.etag);
    if (artwork.notModified) {
      reply.status(304).send();
      return;
    }
    reply.type(artwork.contentType).send(artwork.data);
  }

  @Post(':podcastId/artwork')
  @RequirePermission(Permission.PodcastEditMetadata)
  @Auditable({
    action: AuditAction.PodcastUpdate,
    resource: AuditResource.Podcast,
    getResourceId: (request) => Number(request.params['podcastId']),
    description: 'Uploaded custom podcast artwork',
  })
  async uploadArtwork(
    @Param('podcastId', ParseIntPipe) podcastId: number,
    @CurrentUser() user: RequestUser,
    @Req() request: MultipartRequest,
  ): Promise<PodcastArtworkResult> {
    const file = await request.file();
    if (!file) throw new BadRequestException('No artwork file provided');
    return this.catalog.uploadPodcastArtwork(podcastId, await file.toBuffer(), user);
  }

  @Post(':podcastId/artwork/from-url')
  @RequirePermission(Permission.PodcastEditMetadata)
  @Auditable({
    action: AuditAction.PodcastUpdate,
    resource: AuditResource.Podcast,
    getResourceId: (request) => Number(request.params['podcastId']),
    description: 'Uploaded custom podcast artwork from a URL',
  })
  uploadArtworkFromUrl(
    @Param('podcastId', ParseIntPipe) podcastId: number,
    @Body() dto: UploadPodcastArtworkFromUrlDto,
    @CurrentUser() user: RequestUser,
  ): Promise<PodcastArtworkResult> {
    return this.catalog.uploadPodcastArtworkFromUrl(podcastId, dto.url, user);
  }

  @Delete(':podcastId/artwork')
  @RequirePermission(Permission.PodcastEditMetadata)
  @Auditable({
    action: AuditAction.PodcastUpdate,
    resource: AuditResource.Podcast,
    getResourceId: (request) => Number(request.params['podcastId']),
    description: 'Removed custom podcast artwork',
  })
  deleteArtwork(@Param('podcastId', ParseIntPipe) podcastId: number, @CurrentUser() user: RequestUser): Promise<PodcastArtworkResult> {
    return this.catalog.deletePodcastArtwork(podcastId, user);
  }
}

@Controller('podcast-download-batches')
export class PodcastDownloadBatchController {
  constructor(private readonly operations: PodcastOperationsService) {}

  @Get()
  listActive(@CurrentUser() user: RequestUser): Promise<PodcastDownloadBatch[]> {
    return this.operations.listActiveDownloadBatches(user);
  }

  @Get(':batchId')
  findOne(@Param('batchId', new ParseUUIDPipe({ version: '4' })) batchId: string, @CurrentUser() user: RequestUser): Promise<PodcastDownloadBatch> {
    return this.operations.findDownloadBatch(batchId, user);
  }
}

@Controller('podcast-episodes')
export class PodcastEpisodeController {
  constructor(
    private readonly playback: PodcastPlaybackService,
    private readonly operations: PodcastOperationsService,
    private readonly access: PodcastAccessService,
    private readonly storage: PodcastMediaStorageService,
    private readonly tickets: PodcastStreamTicketService,
  ) {}

  @Post('state-batch')
  stateBatch(@Body() dto: PodcastEpisodeStateBatchDto, @CurrentUser() user: RequestUser): Promise<PodcastEpisodeStateRow[]> {
    return this.playback.listEpisodeStates(user, dto.episodeIds);
  }

  /** Declared ahead of `:episodeId` so the literal segment is not swallowed by the parameterised route. */
  @Get('continue')
  continueListening(@Query() query: ListPodcastContinueDto, @CurrentUser() user: RequestUser): Promise<PodcastEpisodeListItem[]> {
    return this.playback.listContinueListening(user, query);
  }

  @Get(':episodeId')
  getEpisode(@Param('episodeId', ParseIntPipe) episodeId: number, @CurrentUser() user: RequestUser) {
    return this.playback.getEpisode(episodeId, user);
  }

  @Get(':episodeId/playback-context')
  playbackContext(@Param('episodeId', ParseIntPipe) episodeId: number, @CurrentUser() user: RequestUser) {
    return this.playback.getPlaybackContext(episodeId, user);
  }

  @Patch(':episodeId/state')
  updateState(@Param('episodeId', ParseIntPipe) episodeId: number, @Body() dto: UpdateEpisodeStateDto, @CurrentUser() user: RequestUser) {
    return this.playback.updateEpisodeState(episodeId, user, dto);
  }

  @Patch(':episodeId/metadata')
  @RequirePermission(Permission.PodcastEditMetadata)
  @Auditable({
    action: AuditAction.PodcastUpdate,
    resource: AuditResource.PodcastEpisode,
    getResourceId: (request) => Number(request.params['episodeId']),
    description: 'Updated podcast episode metadata',
  })
  updateEpisodeMetadata(
    @Param('episodeId', ParseIntPipe) episodeId: number,
    @Body() dto: UpdatePodcastEpisodeMetadataDto,
    @CurrentUser() user: RequestUser,
  ): Promise<PodcastEpisodeSummary> {
    return this.playback.updateEpisodeMetadata(episodeId, dto, user);
  }

  @Post(':episodeId/download')
  @RequirePermission(Permission.PodcastDownload)
  @Auditable({ action: AuditAction.PodcastDownload, resource: AuditResource.PodcastEpisode, description: 'Queued podcast episode download' })
  download(@Param('episodeId', ParseIntPipe) episodeId: number, @CurrentUser() user: RequestUser) {
    return this.operations.enqueueDownload(episodeId, user);
  }

  @Delete(':episodeId/download')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.PodcastDownload)
  @Auditable({
    action: AuditAction.PodcastDownloadRemove,
    resource: AuditResource.PodcastEpisode,
    description: 'Removed downloaded podcast episode',
  })
  removeDownload(@Param('episodeId', ParseIntPipe) episodeId: number, @CurrentUser() user: RequestUser) {
    return this.operations.removeDownload(episodeId, user);
  }

  @Post(':episodeId/stream-ticket')
  async streamTicket(@Param('episodeId', ParseIntPipe) episodeId: number, @CurrentUser() user: RequestUser): Promise<PodcastStreamTicket> {
    await this.access.requireEpisodeAccess(episodeId, user);
    return this.tickets.issue(episodeId, user);
  }

  @Get(':episodeId/stream')
  @Public()
  @UseGuards(PodcastStreamAuthGuard)
  async stream(
    @Param('episodeId', ParseIntPipe) episodeId: number,
    @Headers('range') range: string | undefined,
    @CurrentUser() user: RequestUser,
    @Res() reply: FastifyReply,
  ) {
    // Set before anything can fail, so it covers the local file, the proxied remote, and the error
    // responses too. A 410 is cacheable by default, and a browser that stored one would keep
    // replaying it against an episode the server has since been able to serve again.
    reply.header('Cache-Control', 'private, no-store');
    await this.access.requireEpisodeAccess(episodeId, user);
    const localMedia = await this.storage.findAvailableLocalMedia(episodeId);
    if (localMedia) {
      await streamLocalFile(localMedia, range, reply);
      return;
    }
    const response = await this.storage.openRemoteMedia(episodeId, range);
    reply.status(response.status);
    for (const header of ['accept-ranges', 'content-length', 'content-range', 'content-type', 'etag', 'last-modified']) {
      const value = response.headers.get(header);
      if (value) reply.header(header, value);
    }
    if (!response.body) {
      reply.send();
      return;
    }
    reply.send(Readable.from(readWebStream(response.body)));
  }

  @Post(':episodeId/queue')
  @HttpCode(HttpStatus.NO_CONTENT)
  addQueue(@Param('episodeId', ParseIntPipe) episodeId: number, @Body() dto: QueuePodcastEpisodeDto, @CurrentUser() user: RequestUser) {
    return this.playback.addQueueItem(episodeId, user, dto);
  }

  @Delete(':episodeId/queue')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeQueue(@Param('episodeId', ParseIntPipe) episodeId: number, @CurrentUser() user: RequestUser) {
    return this.playback.removeQueueItem(episodeId, user);
  }

  @Get(':episodeId/bookmarks')
  bookmarks(@Param('episodeId', ParseIntPipe) episodeId: number, @CurrentUser() user: RequestUser): Promise<PodcastBookmark[]> {
    return this.playback.listBookmarks(episodeId, user);
  }

  @Post(':episodeId/bookmarks')
  createBookmark(
    @Param('episodeId', ParseIntPipe) episodeId: number,
    @Body() dto: CreatePodcastBookmarkDto,
    @CurrentUser() user: RequestUser,
  ): Promise<PodcastBookmark> {
    return this.playback.createBookmark(episodeId, user, dto);
  }

  @Post(':episodeId/sessions')
  @HttpCode(HttpStatus.NO_CONTENT)
  createSession(@Param('episodeId', ParseIntPipe) episodeId: number, @Body() dto: CreatePodcastSessionDto, @CurrentUser() user: RequestUser) {
    return this.playback.createListeningSession(episodeId, user, dto);
  }
}

@Controller('podcast-queue')
export class PodcastQueueController {
  constructor(private readonly playback: PodcastPlaybackService) {}

  @Get()
  list(@Query() query: ListPodcastQueueDto, @CurrentUser() user: RequestUser): Promise<PodcastQueuePage> {
    return this.playback.listQueue(user, query);
  }

  @Patch()
  @HttpCode(HttpStatus.NO_CONTENT)
  reorder(@Body() dto: ReorderPodcastQueueDto, @CurrentUser() user: RequestUser) {
    return this.playback.reorderQueue(user, dto);
  }

  /** Single-row move, so a client dragging one entry never uploads the whole membership. */
  @Patch('move')
  @HttpCode(HttpStatus.NO_CONTENT)
  move(@Body() dto: MovePodcastQueueDto, @CurrentUser() user: RequestUser) {
    return this.playback.moveQueueItem(user, dto);
  }

  @Post('restore')
  restore(@Body() dto: RestorePodcastQueueDto, @CurrentUser() user: RequestUser) {
    return this.playback.restoreQueue(user, dto);
  }

  @Delete('finished')
  clearFinished(@CurrentUser() user: RequestUser) {
    return this.playback.clearFinishedQueue(user);
  }

  @Delete()
  clear(@CurrentUser() user: RequestUser) {
    return this.playback.clearQueue(user);
  }
}

@Controller('podcast-bookmarks')
export class PodcastBookmarkController {
  constructor(private readonly playback: PodcastPlaybackService) {}

  @Delete(':bookmarkId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('bookmarkId', ParseIntPipe) bookmarkId: number, @CurrentUser() user: RequestUser) {
    return this.playback.deleteBookmark(bookmarkId, user);
  }

  @Patch(':bookmarkId')
  update(@Param('bookmarkId', ParseIntPipe) bookmarkId: number, @Body() dto: UpdatePodcastBookmarkDto, @CurrentUser() user: RequestUser) {
    return this.playback.updateBookmark(bookmarkId, user, dto);
  }
}

async function streamLocalFile(
  media: { handle: FileHandle; size: number; mimeType: string; fileName: string | null; checksum: string | null },
  range: string | undefined,
  reply: FastifyReply,
): Promise<void> {
  const { handle, size, mimeType, fileName } = media;
  reply.header('Accept-Ranges', 'bytes');
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Content-Disposition', contentDispositionHeader('inline', fileName ?? 'episode', 'episode'));
  reply.type(mimeType);
  if (range) {
    const parsedRange = parsePodcastByteRange(range, size);
    if (!parsedRange) {
      await handle.close();
      reply.status(416).header('Content-Range', `bytes */${size}`).send();
      return;
    }
    // Deliberately no digest on a partial response: the recorded checksum covers the whole file,
    // and a client cannot verify it against the bytes of one range.
    reply
      .status(206)
      .header('Content-Range', `bytes ${parsedRange.start}-${parsedRange.end}/${size}`)
      .header('Content-Length', parsedRange.end - parsedRange.start + 1);
    reply.send(handle.createReadStream({ ...parsedRange, autoClose: true }));
    return;
  }
  if (media.checksum) reply.header('X-Content-Sha256', media.checksum);
  reply.header('Content-Length', size).send(handle.createReadStream({ autoClose: true }));
}

async function* readWebStream(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
