import { Body, Controller, DefaultValuePipe, Get, HttpCode, HttpStatus, Param, ParseBoolPipe, ParseIntPipe, Post, Query } from '@nestjs/common';
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
import { GrabBookRequestDto } from './dto/grab-book-request.dto';
import { InspectBookRequestReleaseDto } from './dto/inspect-book-request-release.dto';
import { SelectReleaseUnitDto } from './dto/select-release-unit.dto';
import { SearchBookRequestReleasesDto } from './dto/search-book-request-releases.dto';

/**
 * Fulfilling your own request without an approver in the loop. Every route here has an identical
 * twin under `admin/book-requests`; the difference is who may call it and on which rows, which
 * `assertCanFulfil` answers per request rather than the guard answering once for all of them.
 *
 * Its own path rather than a segment under `book-requests`, for the reason the automation
 * controller has one: `book-requests/:id` would match `book-requests/download-clients` first and
 * reject it in the integer pipe before this controller was ever consulted.
 *
 * A method-level `@RequirePermission` would not have worked either. `PermissionGuard` reads with
 * `getAllAndOverride`, so a handler-level permission *replaces* the class-level one instead of
 * adding to it, and these routes would have stopped requiring `BookRequestAccess` at all.
 *
 * Deliberately absent: `fulfill`, which closes a request by hand, and removing a torrent from a
 * download client. Both act on shared infrastructure rather than on this download, and cancelling
 * already stops a transfer for the person who started it.
 */
@Controller('book-request-fulfilment')
@RequirePermission(Permission.BookRequestAccess, Permission.BookRequestSelfFulfill)
export class BookRequestSelfFulfilController {
  constructor(
    private readonly service: BookRequestService,
    private readonly fulfillment: RequestFulfillmentService,
    private readonly downloadClients: DownloadClientConfigService,
    private readonly seed: RequestSeedService,
    private readonly imports: RequestImportService,
    private readonly verification: RequestVerificationService,
  ) {}

  /** Names and ids only, so the grab dialog can offer a choice it is allowed to act on. */
  @Get('download-clients')
  listDownloadClients() {
    return this.downloadClients.findEnabledSummaries('torrent');
  }

  @Get(':id/releases')
  async listReleases(
    @Param('id', ParseIntPipe) id: number,
    @Query('refresh', new DefaultValuePipe(false), ParseBoolPipe) refresh: boolean,
    @CurrentUser() user: RequestUser,
  ) {
    await this.service.assertCanFulfil(id, user);
    return this.fulfillment.listReleases(id, { refresh });
  }

  @Post(':id/releases/search')
  @HttpCode(HttpStatus.OK)
  async searchReleases(@Param('id', ParseIntPipe) id: number, @Body() dto: SearchBookRequestReleasesDto, @CurrentUser() user: RequestUser) {
    await this.service.assertCanFulfil(id, user);
    return this.fulfillment.listReleases(id, { refresh: true, overrides: dto });
  }

  @Post(':id/releases/inspect')
  @HttpCode(HttpStatus.OK)
  async inspectRelease(@Param('id', ParseIntPipe) id: number, @Body() dto: InspectBookRequestReleaseDto, @CurrentUser() user: RequestUser) {
    await this.service.assertCanFulfil(id, user);
    return this.fulfillment.inspectRelease(id, dto);
  }

  @Post(':id/grab')
  @HttpCode(HttpStatus.OK)
  @Auditable({
    action: AuditAction.BookRequestGrab,
    resource: AuditResource.BookRequest,
    getResourceId: (req) => Number(req.params.id),
    description: 'Sent their own book request to a download client',
  })
  async grab(@Param('id', ParseIntPipe) id: number, @Body() dto: GrabBookRequestDto, @CurrentUser() user: RequestUser) {
    await this.service.assertCanFulfil(id, user);
    return this.fulfillment.grab(id, dto, user);
  }

  @Get(':id/attempts')
  async attempts(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    await this.service.assertCanFulfil(id, user);
    return this.fulfillment.listAttempts(id);
  }

  /** Read only. Stopping a seed is a decision about shared infrastructure, so it stays moderator-only. */
  @Get(':id/seed')
  async seedStatus(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    await this.service.assertCanFulfil(id, user);
    return this.seed.getSeedStatus(id);
  }

  @Get(':id/review')
  async getReview(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    await this.service.assertCanFulfil(id, user);
    return this.verification.getReview(id);
  }

  /**
   * Overriding the verifier on a release you picked deliberately. Without this the feature would
   * dead-end exactly where auto-approval does: a below-threshold score on your own choice is a
   * common outcome, not a rare one.
   */
  @Post(':id/force-file')
  @HttpCode(HttpStatus.OK)
  @Auditable({
    action: AuditAction.BookRequestImport,
    resource: AuditResource.BookRequest,
    getResourceId: (req) => Number(req.params.id),
    description: 'Filed their own held book request import',
  })
  async forceFile(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    await this.service.assertCanFulfil(id, user);
    await this.verification.fileHeldImport(id, user);
    return this.service.getOne(id, user);
  }

  /**
   * The other half of reviewing your own import. Filing needs a destination and force-filing is
   * an override; this is the answer when the release turned out to be the wrong book. The dock
   * entry goes through the dock's own discard, so a self-fulfiller without Book Dock permissions
   * can still clear up after themselves rather than leaving an orphan behind.
   */
  @Post(':id/discard-import')
  @HttpCode(HttpStatus.OK)
  @Auditable({
    action: AuditAction.BookRequestImport,
    resource: AuditResource.BookRequest,
    getResourceId: (req) => Number(req.params.id),
    description: 'Discarded their own held book request import',
  })
  async discardImport(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    await this.service.assertCanFulfil(id, user);
    await this.verification.discardHeldImport(id, user);
    return this.service.getOne(id, user);
  }

  @Post(':id/downloads/:downloadId/select-unit')
  @HttpCode(HttpStatus.OK)
  @Auditable({
    action: AuditAction.BookRequestImport,
    resource: AuditResource.BookRequest,
    getResourceId: (req) => Number(req.params.id),
    description: 'Chose which book to import from their own multi-book release',
  })
  async selectReleaseUnit(
    @Param('id', ParseIntPipe) id: number,
    @Param('downloadId', ParseIntPipe) downloadId: number,
    @Body() dto: SelectReleaseUnitDto,
    @CurrentUser() user: RequestUser,
  ) {
    await this.service.assertCanFulfil(id, user);
    return this.imports.importChosenUnit(id, downloadId, dto.unitIndex);
  }
}
