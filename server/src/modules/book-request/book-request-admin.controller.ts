import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { AuditAction, AuditResource, Permission } from '@bookorbit/types';

import { Auditable } from '../../common/decorators/auditable.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { BookRequestService } from './book-request.service';
import { DownloadClientConfigService } from './download-clients/download-client-config.service';
import { RequestFulfillmentService } from './fulfillment/request-fulfillment.service';
import { RequestImportService } from './fulfillment/request-import.service';
import { RequestSeedService } from './fulfillment/request-seed.service';
import { RequestVerificationService } from './fulfillment/request-verification.service';
import { BulkBookRequestsDto, BulkRejectBookRequestsDto } from './dto/bulk-book-requests.dto';
import { DecideBookRequestDto } from './dto/decide-book-request.dto';
import { GrabBookRequestDto } from './dto/grab-book-request.dto';
import { InspectBookRequestReleaseDto } from './dto/inspect-book-request-release.dto';
import { FulfillBookRequestDto } from './dto/fulfill-book-request.dto';
import { ListAllBookRequestsDto } from './dto/list-book-requests.dto';
import { ListRequesterOptionsDto } from './dto/list-requester-options.dto';
import { SelectReleaseUnitDto } from './dto/select-release-unit.dto';
import { RemoveDownloadDto } from './dto/remove-download.dto';
import { SearchBookRequestReleasesDto } from './dto/search-book-request-releases.dto';

/**
 * Moderating the queue is a different level of trust from requesting, so this whole controller
 * sits behind `ManageBookRequests` rather than `BookRequestAccess`.
 */
@Controller('admin/book-requests')
@RequirePermission(Permission.ManageBookRequests)
export class BookRequestAdminController {
  constructor(
    private readonly service: BookRequestService,
    private readonly fulfillment: RequestFulfillmentService,
    private readonly downloadClients: DownloadClientConfigService,
    private readonly seed: RequestSeedService,
    private readonly imports: RequestImportService,
    private readonly verification: RequestVerificationService,
  ) {}

  @Get()
  listAll(@Query() query: ListAllBookRequestsDto, @CurrentUser() user: RequestUser) {
    return this.service.listAll(query, user);
  }

  @Get('requesters')
  listRequesters(@Query() query: ListRequesterOptionsDto) {
    return this.service.listRequesterOptions(query);
  }

  /**
   * Just enough for the grab dialog to offer a choice. Managing the rows themselves needs
   * `ManageAppSettings`, so an approver without it would otherwise see a dialog it could not use
   * for an endpoint that would have accepted the grab.
   */
  @Get('download-clients')
  listDownloadClients() {
    return this.downloadClients.findEnabledSummaries('torrent');
  }

  /**
   * The ranked release list, merged across every enabled indexer and scored against the request.
   * A repeat open is served from a short-lived cache; `refresh` is the way past it, so reopening
   * the picker does not re-hit a private tracker.
   */
  @Get(':id/releases')
  listReleases(@Param('id', ParseIntPipe) id: number, @Query('refresh', new DefaultValuePipe(false), ParseBoolPipe) refresh: boolean) {
    return this.fulfillment.listReleases(id, { refresh });
  }

  @Post(':id/releases/search')
  @HttpCode(HttpStatus.OK)
  searchReleases(@Param('id', ParseIntPipe) id: number, @Body() dto: SearchBookRequestReleasesDto) {
    return this.fulfillment.listReleases(id, { refresh: true, overrides: dto });
  }

  /** Fetches only the selected release's metadata and never exposes its credentialed URL. */
  @Post(':id/releases/inspect')
  @HttpCode(HttpStatus.OK)
  inspectRelease(@Param('id', ParseIntPipe) id: number, @Body() dto: InspectBookRequestReleaseDto) {
    return this.fulfillment.inspectRelease(id, dto);
  }

  /**
   * Bulk approval. Declared before `:id/approve` for readability only; the two never collide,
   * since one path has a segment the other does not.
   */
  @Post('approve')
  @HttpCode(HttpStatus.OK)
  @Auditable({
    action: AuditAction.BookRequestApprove,
    resource: AuditResource.BookRequest,
    getMeta: (_req, body) => {
      const result = body as { updated?: unknown[]; failed?: unknown[] } | null;
      return { approved: result?.updated?.length ?? 0, failed: result?.failed?.length ?? 0 };
    },
    description: 'Approved a selection of book requests',
  })
  approveMany(@Body() dto: BulkBookRequestsDto, @CurrentUser() user: RequestUser) {
    return this.service.approveMany(dto, user);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Auditable({
    action: AuditAction.BookRequestApprove,
    resource: AuditResource.BookRequest,
    getResourceId: (req) => Number(req.params.id),
    description: 'Approved a book request',
  })
  approve(@Param('id', ParseIntPipe) id: number, @Body() dto: DecideBookRequestDto, @CurrentUser() user: RequestUser) {
    return this.service.approve(id, dto, user);
  }

  /**
   * Bulk rejection, with the one note that applies to the whole selection. Declared before
   * `:id/reject` for the same reason `approve` is: readability, since the two never collide.
   */
  @Post('reject')
  @HttpCode(HttpStatus.OK)
  @Auditable({
    action: AuditAction.BookRequestReject,
    resource: AuditResource.BookRequest,
    getMeta: (_req, body) => {
      const result = body as { updated?: unknown[]; failed?: unknown[] } | null;
      return { rejected: result?.updated?.length ?? 0, failed: result?.failed?.length ?? 0 };
    },
    description: 'Rejected a selection of book requests',
  })
  rejectMany(@Body() dto: BulkRejectBookRequestsDto, @CurrentUser() user: RequestUser) {
    return this.service.rejectMany(dto, user);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @Auditable({
    action: AuditAction.BookRequestReject,
    resource: AuditResource.BookRequest,
    getResourceId: (req) => Number(req.params.id),
    description: 'Rejected a book request',
  })
  reject(@Param('id', ParseIntPipe) id: number, @Body() dto: DecideBookRequestDto, @CurrentUser() user: RequestUser) {
    return this.service.reject(id, dto, user);
  }

  /**
   * The escape hatch for a settled row nobody wants in the history any more. Everyone else gets
   * dismissal, which hides a request without taking the record of it away from the other people
   * who asked for the same book.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditable({
    action: AuditAction.BookRequestDelete,
    resource: AuditResource.BookRequest,
    getResourceId: (req) => Number(req.params.id),
    description: 'Deleted a book request',
  })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.service.remove(id, user);
  }

  @Post(':id/fulfill')
  @HttpCode(HttpStatus.OK)
  @Auditable({
    action: AuditAction.BookRequestFulfill,
    resource: AuditResource.BookRequest,
    getResourceId: (req) => Number(req.params.id),
    description: 'Marked a book request fulfilled',
  })
  fulfill(@Param('id', ParseIntPipe) id: number, @Body() dto: FulfillBookRequestDto, @CurrentUser() user: RequestUser) {
    return this.service.markFulfilled(id, dto, user);
  }

  /**
   * What is actually sitting in the dock, and what the score was measuring. Read on demand rather
   * than folded into the request itself: it costs a dock read plus a settings read, and the list
   * renders hundreds of rows that will never be opened.
   */
  @Get(':id/review')
  getReview(@Param('id', ParseIntPipe) id: number) {
    return this.verification.getReview(id);
  }

  /** The approver disagrees with the score. Files the held import exactly as a pass would have. */
  @Post(':id/force-file')
  @HttpCode(HttpStatus.OK)
  @Auditable({
    action: AuditAction.BookRequestImport,
    resource: AuditResource.BookRequest,
    getResourceId: (req) => Number(req.params.id),
    description: 'Filed a held book request import',
  })
  async forceFile(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    await this.verification.fileHeldImport(id, user);
    return this.service.getOne(id, user);
  }

  /**
   * The other answer to a held import: it is the wrong book, so the entry is discarded and the
   * request fails. Without this the only way out was cancelling, which left the dock entry behind
   * as an orphan nobody would connect back to a request.
   */
  @Post(':id/discard-import')
  @HttpCode(HttpStatus.OK)
  @Auditable({
    action: AuditAction.BookRequestImport,
    resource: AuditResource.BookRequest,
    getResourceId: (req) => Number(req.params.id),
    description: 'Discarded a held book request import',
  })
  async discardImport(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    await this.verification.discardHeldImport(id, user);
    return this.service.getOne(id, user);
  }

  /**
   * Fulfilment: the approver picks a release out of the ranked list, or hands over a magnet or a
   * .torrent by hand. All three go down the same pipeline from here.
   */
  @Post(':id/grab')
  @HttpCode(HttpStatus.OK)
  @Auditable({
    action: AuditAction.BookRequestGrab,
    resource: AuditResource.BookRequest,
    getResourceId: (req) => Number(req.params.id),
    description: 'Sent a book request to a download client',
  })
  grab(@Param('id', ParseIntPipe) id: number, @Body() dto: GrabBookRequestDto, @CurrentUser() user: RequestUser) {
    return this.fulfillment.grab(id, dto, user);
  }

  /**
   * Every release this request has been sent to, newest first, including the ones a source refused
   * before anything was downloaded. Read on demand rather than carried on the request: the queue
   * shows the current attempt, and only somebody looking at one request wants the rest.
   */
  @Get(':id/attempts')
  attempts(@Param('id', ParseIntPipe) id: number) {
    return this.fulfillment.listAttempts(id);
  }

  /**
   * What the client is doing with this request's torrent, read live. Null when there is no
   * attempt to ask about, or when the client no longer holds it.
   */
  @Get(':id/seed')
  seedStatus(@Param('id', ParseIntPipe) id: number) {
    return this.seed.getSeedStatus(id);
  }

  /**
   * Resolves a held attempt whose release turned out to hold several distinct books. The download
   * is untouched and still on disk, so this finishes the import that stopped at the question
   * rather than starting a new attempt.
   */
  @Post(':id/downloads/:downloadId/select-unit')
  @HttpCode(HttpStatus.OK)
  @Auditable({
    action: AuditAction.BookRequestImport,
    resource: AuditResource.BookRequest,
    getResourceId: (req) => Number(req.params.id),
    description: 'Chose which book to import from a multi-book release',
  })
  selectReleaseUnit(@Param('id', ParseIntPipe) id: number, @Param('downloadId', ParseIntPipe) downloadId: number, @Body() dto: SelectReleaseUnitDto) {
    return this.imports.importChosenUnit(id, downloadId, dto.unitIndex);
  }

  /**
   * The one action BookOrbit takes against a seed. Removing one that is still working also fails
   * the request: nothing else is going to finish it, and saying so beats leaving it at
   * "downloading" until the watchdog notices twelve hours later.
   */
  @Post(':id/downloads/:downloadId/remove')
  @HttpCode(HttpStatus.OK)
  @Auditable({
    action: AuditAction.BookRequestRemoveDownload,
    resource: AuditResource.BookRequest,
    getResourceId: (req) => Number(req.params.id),
    description: 'Removed a book request download from its download client',
  })
  removeDownload(
    @Param('id', ParseIntPipe) id: number,
    @Param('downloadId', ParseIntPipe) downloadId: number,
    @Body() dto: RemoveDownloadDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.seed.removeFromClient(id, downloadId, dto.deleteFiles ?? false, user);
  }
}
