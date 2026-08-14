import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { KoboDevice } from './decorators/kobo-device.decorator';
import type { KoboDeviceContext } from './guards/kobo-token.guard';
import { KoboTokenGuard } from './guards/kobo-token.guard';
import { KoboSettingsService } from './services/kobo-settings.service';
import { KoboSyncService } from './services/kobo-sync.service';
import { KoboReadingStateService } from './services/kobo-reading-state.service';
import type { KoboProxyResponse } from './services/kobo-proxy.service';
import { KoboProxyService } from './services/kobo-proxy.service';
import { KOBO_STORE_RESOURCES } from './kobo-store-resources';
import { KoboBookIdentityService } from './services/kobo-book-identity.service';
import { KoboSyncHistoryService } from './services/kobo-sync-history.service';
import { decodeSyncToken, isUsableKoboSyncToken, withKoboSyncToken } from './services/kobo-sync-token';

const STORE_SYNC_TIMEOUT_MS = 8_000;
const KOBO_SYNC_TOKEN_HEADER = 'x-kobo-synctoken';

// Kobo answers a delete for a tag it does not know with a client error, and the device keeps the
// operation queued until it succeeds, so relaying that error strands a tag that no longer exists
// anywhere in a delete it can never complete. Server faults and auth failures still reach the
// device, because those mean "try again later" rather than "already gone".
const TAG_ALREADY_GONE_STATUSES: number[] = [HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.GONE];

type StoreSyncResult = {
  entitlements: unknown[];
  hasMore: boolean;
  syncToken: string | undefined;
};

function readHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isBookOrbitTag(tagId: string): boolean {
  return tagId.startsWith('col-') || tagId.startsWith('ss-');
}

function buildBaseUrl(req: FastifyRequest): string {
  const fwdHost = readHeaderValue(req.headers['x-forwarded-host']);
  const fwdPort = readHeaderValue(req.headers['x-forwarded-port']);
  const fwdProto = readHeaderValue(req.headers['x-forwarded-proto']);
  const hasForwarded = fwdHost || fwdPort || fwdProto;
  const proto = fwdProto ?? req.protocol;
  const headerHost = fwdHost ?? readHeaderValue(req.headers.host);
  let host = headerHost ?? req.hostname;

  if (!host.includes(':')) {
    const port = fwdPort ?? null;
    if (port) {
      const isDefault = (proto === 'http' && port === '80') || (proto === 'https' && port === '443');
      if (!isDefault) host = host + ':' + port;
    } else if (!hasForwarded) {
      const localPort = req.socket?.localPort;
      const isDefault = (proto === 'http' && localPort === 80) || (proto === 'https' && localPort === 443);
      if (localPort && !isDefault) host = host + ':' + String(localPort);
    }
  }

  return proto + '://' + host;
}

function buildReadingServicesBaseUrl(req: FastifyRequest, baseUrl: string): string {
  const localPort = req.socket?.localPort;
  if (!localPort) return baseUrl;

  const url = new URL(baseUrl);
  if (url.port !== '5173') return baseUrl;

  const proto = readHeaderValue(req.headers['x-forwarded-proto']) ?? req.protocol;
  url.protocol = proto + ':';
  url.port = String(localPort);
  return url.toString().replace(/\/$/, '');
}

@Controller('kobo/:deviceToken')
@Public()
@UseGuards(KoboTokenGuard)
export class KoboSyncController {
  private readonly logger = new Logger(KoboSyncController.name);

  constructor(
    private readonly settingsService: KoboSettingsService,
    private readonly syncService: KoboSyncService,
    private readonly readingStateService: KoboReadingStateService,
    private readonly proxyService: KoboProxyService,
    private readonly bookIdentityService: KoboBookIdentityService,
    private readonly historyService: KoboSyncHistoryService,
  ) {}

  @Get('v1/initialization')
  @Header('x-kobo-apitoken', 'e30=')
  initialization(@KoboDevice() device: KoboDeviceContext, @Req() req: FastifyRequest) {
    const baseUrl = buildBaseUrl(req);
    const readingServicesBaseUrl = buildReadingServicesBaseUrl(req, baseUrl);
    const t = device.deviceToken;
    return {
      Resources: {
        ...KOBO_STORE_RESOURCES,
        image_host: baseUrl,
        image_url_template: `${baseUrl}/api/v1/kobo/${t}/v1/books/{ImageId}/thumbnail/{Width}/{Height}/false/image.jpg`,
        image_url_quality_template: `${baseUrl}/api/v1/kobo/${t}/v1/books/{ImageId}/thumbnail/{Width}/{Height}/{Quality}/{IsGreyscale}/image.jpg`,
        library_sync: `${baseUrl}/api/v1/kobo/${t}/v1/library/sync`,
        reading_state: `${baseUrl}/api/v1/kobo/${t}/v1/library/{Ids}/state`,
        get_tests_request: `${baseUrl}/api/v1/kobo/${t}/v1/analytics/gettests`,
        post_analytics_event: `${baseUrl}/api/v1/kobo/${t}/v1/analytics/event`,
        reading_services_host: readingServicesBaseUrl,
      },
    };
  }

  @Get('v1/library/sync')
  async librarySync(
    @KoboDevice() device: KoboDeviceContext,
    @CurrentUser() user: RequestUser,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const startedAt = Date.now();
    this.logger.debug(`[kobo.library_sync] [start] userId=${user.id} deviceId=${device.deviceId} - library sync started`);
    const baseUrl = buildBaseUrl(req);
    let result: { entitlements: unknown[]; hasMore: boolean; syncToken: string };
    try {
      result = await this.syncService.getDelta(user.id, device.deviceId, device.deviceToken, baseUrl);
    } catch (error: unknown) {
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      const errorMessage = sanitizeLogValue(error instanceof Error ? error.message : 'unknown error');
      this.logger.error(
        `[kobo.library_sync] [fail] userId=${user.id} deviceId=${device.deviceId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - library sync failed`,
      );
      await this.historyService.recordFailure(
        {
          userId: user.id,
          deviceId: device.deviceId,
          event: 'library_sync',
          durationMs: Date.now() - startedAt,
        },
        error,
      );
      throw error;
    }
    const { entitlements, hasMore, syncToken } = result;

    // Reach for the store only once BookOrbit has drained its own pages, so the device is never
    // asked to reconcile two independent cursors out of a single response.
    const incomingKoboSyncToken = decodeSyncToken(readHeaderValue(req.headers[KOBO_SYNC_TOKEN_HEADER])).koboSyncToken;
    const store = hasMore ? null : await this.fetchStoreEntitlements(req, device, user.id, incomingKoboSyncToken);

    const merged = store ? [...entitlements, ...store.entitlements] : entitlements;

    // Kobo's cursor rides inside our token, so one too large to carry means the next store sync
    // starts over. Say so rather than letting the store silently resend its whole library.
    if (store?.syncToken !== undefined && !isUsableKoboSyncToken(store.syncToken)) {
      this.logger.warn(
        `[kobo.store_sync] [fail] userId=${user.id} deviceId=${device.deviceId} errorClass=StoreCursorTooLarge tokenLength=${store.syncToken.length} - upstream cursor dropped, the next store sync starts from the beginning`,
      );
    }

    // Replaying an unchanged cursor returns the same page forever, so keep paging the store only
    // while its token actually advances. The page just fetched is still delivered either way.
    const storeCursorAdvanced = store?.syncToken !== undefined && store.syncToken !== incomingKoboSyncToken;
    if (store?.hasMore === true && !storeCursorAdvanced) {
      this.logger.warn(
        `[kobo.store_sync] [fail] userId=${user.id} deviceId=${device.deviceId} errorClass=StoreCursorStalled error="continue without an advanced sync token" - store paging stopped to avoid a sync loop`,
      );
    }
    const combinedHasMore = hasMore || (store?.hasMore === true && storeCursorAdvanced);

    this.logger.debug(
      `[kobo.library_sync] [end] userId=${user.id} deviceId=${device.deviceId} durationMs=${Date.now() - startedAt} entitlementCount=${entitlements.length} storeEntitlementCount=${store?.entitlements.length ?? 0} hasMore=${combinedHasMore} - library sync completed`,
    );
    await this.historyService.recordSuccess({
      userId: user.id,
      deviceId: device.deviceId,
      event: 'library_sync',
      durationMs: Date.now() - startedAt,
      counts: {
        entitlements: merged.length,
        hasMore: combinedHasMore,
        ...(store ? { storeEntitlements: store.entitlements.length } : {}),
      },
    });
    reply.header('x-kobo-sync', combinedHasMore ? 'continue' : '');
    reply.header('x-kobo-synctoken', withKoboSyncToken(syncToken, store?.syncToken ?? incomingKoboSyncToken));
    reply.send(merged);
  }

  /**
   * Pulls the device's Kobo Plus and Kobo store entitlements using the device's own Kobo
   * credentials, which reach us because initialization leaves device_auth and device_refresh
   * pointing at Kobo. Returns null when the user has store sync switched off.
   *
   * Never throws: reading the setting, or a store that is slow, down or unauthorized, costs the
   * store page and never the BookOrbit half of the sync.
   */
  private async fetchStoreEntitlements(
    req: FastifyRequest,
    device: KoboDeviceContext,
    userId: number,
    koboSyncToken: string | undefined,
  ): Promise<StoreSyncResult | null> {
    const startedAt = Date.now();
    try {
      const { storeSync } = await this.settingsService.getSettings(userId);
      if (!storeSync) return null;

      this.logger.debug(
        `[kobo.store_sync] [start] userId=${userId} deviceId=${device.deviceId} hasKoboToken=${Boolean(koboSyncToken)} - upstream store sync started`,
      );

      // Our own composite token means nothing to Kobo, so it is replaced when we hold Kobo's
      // cursor and dropped entirely when we do not, which asks the store for a full sync.
      const response = await this.proxyService.request(req, device.deviceToken, {
        ...(koboSyncToken ? { extraHeaders: { [KOBO_SYNC_TOKEN_HEADER]: koboSyncToken } } : { omitHeaders: [KOBO_SYNC_TOKEN_HEADER] }),
        timeoutMs: STORE_SYNC_TIMEOUT_MS,
      });

      if (response.status < 200 || response.status >= 300) {
        this.logger.warn(
          `[kobo.store_sync] [fail] userId=${userId} deviceId=${device.deviceId} durationMs=${Date.now() - startedAt} status=${response.status} - upstream store sync returned an error status`,
        );
        return null;
      }

      // An empty body carries no cursor we can trust, so treat it as no store data this round
      // rather than advancing past a page Kobo may still owe us.
      const rawBody = response.body.toString('utf8').trim();
      if (rawBody.length === 0) {
        this.logger.warn(
          `[kobo.store_sync] [fail] userId=${userId} deviceId=${device.deviceId} durationMs=${Date.now() - startedAt} status=${response.status} - upstream store sync returned an empty body`,
        );
        return null;
      }

      const parsed: unknown = JSON.parse(rawBody);
      if (!Array.isArray(parsed)) {
        this.logger.warn(
          `[kobo.store_sync] [fail] userId=${userId} deviceId=${device.deviceId} durationMs=${Date.now() - startedAt} status=${response.status} - upstream store sync returned a non-array body`,
        );
        return null;
      }

      const hasMore = response.headers['x-kobo-sync']?.trim().toLowerCase() === 'continue';
      this.logger.debug(
        `[kobo.store_sync] [end] userId=${userId} deviceId=${device.deviceId} durationMs=${Date.now() - startedAt} storeEntitlementCount=${parsed.length} hasMore=${hasMore} - upstream store sync completed`,
      );
      return { entitlements: parsed, hasMore, syncToken: response.headers[KOBO_SYNC_TOKEN_HEADER] };
    } catch (error: unknown) {
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      const errorMessage = sanitizeLogValue(error instanceof Error ? error.message : 'unknown error');
      this.logger.warn(
        `[kobo.store_sync] [fail] userId=${userId} deviceId=${device.deviceId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - upstream store sync failed, serving BookOrbit entitlements only`,
      );
      return null;
    }
  }

  @Post('v1/library/tags/:tagId/items/delete')
  @HttpCode(HttpStatus.OK)
  async deleteTagItems(
    @Param('tagId') tagId: string,
    @KoboDevice() device: KoboDeviceContext,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    if (!isBookOrbitTag(tagId)) return this.forwardTagDelete(req, reply, device, tagId);
    reply.status(HttpStatus.OK).send({ RequestResult: 'Success' });
  }

  @Post('v1/library/tags/:tagId/items')
  @HttpCode(HttpStatus.OK)
  async addTagItems(@Param('tagId') tagId: string, @KoboDevice() device: KoboDeviceContext, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    if (!isBookOrbitTag(tagId)) return this.proxyService.forward(req, reply, device.deviceToken);
    reply.status(HttpStatus.OK).send({ RequestResult: 'Success' });
  }

  @Delete('v1/library/tags/:tagId')
  @HttpCode(HttpStatus.OK)
  async deleteTag(@Param('tagId') tagId: string, @KoboDevice() device: KoboDeviceContext, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    if (!isBookOrbitTag(tagId)) return this.forwardTagDelete(req, reply, device, tagId);
    reply.status(HttpStatus.OK).send({ RequestResult: 'Success' });
  }

  /**
   * Forwards a delete for a tag BookOrbit does not own, reporting success when Kobo says the tag is
   * not there. Only deletes get this treatment: a failed add must stay a failure, because reporting
   * success would drop the device's pending change instead of retrying it.
   */
  private async forwardTagDelete(req: FastifyRequest, reply: FastifyReply, device: KoboDeviceContext, tagId: string): Promise<void> {
    let response: KoboProxyResponse;
    try {
      response = await this.proxyService.request(req, device.deviceToken);
    } catch (error: unknown) {
      // A path that does not resolve to Kobo is rejected before the request leaves, and that stays
      // the client error the shared proxy raises rather than becoming an upstream fault.
      if (error instanceof HttpException) throw error;
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      const errorMessage = sanitizeLogValue(error instanceof Error ? error.message : 'unknown error');
      this.logger.warn(
        `[kobo.tag_delete] [fail] deviceId=${device.deviceId} errorClass=${errorClass} error="${errorMessage}" - upstream tag delete failed`,
      );
      reply.status(HttpStatus.BAD_GATEWAY).send({ message: 'Upstream Kobo API unavailable' });
      return;
    }

    if (TAG_ALREADY_GONE_STATUSES.includes(response.status)) {
      this.logger.warn(
        `[kobo.tag_delete] [end] deviceId=${device.deviceId} tagId="${sanitizeLogValue(tagId)}" status=${response.status} - upstream does not know this tag, reporting success so the device stops retrying`,
      );
      reply.status(HttpStatus.OK).send({ RequestResult: 'Success' });
      return;
    }

    this.proxyService.sendUpstream(reply, response);
  }

  @Get('v1/library/:bookId/metadata')
  async getBookMetadata(
    @Param('bookId') bookId: string,
    @CurrentUser() user: RequestUser,
    @KoboDevice() device: KoboDeviceContext,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const id = await this.bookIdentityService.resolveBookIdByEntitlementId(user.id, bookId);
    if (id === null) return this.proxyService.forward(req, reply, device.deviceToken);
    const baseUrl = buildBaseUrl(req);
    const metadata = await this.syncService.getBookMetadata(user.id, id, device.deviceToken, baseUrl);
    reply.send(metadata);
  }

  @Delete('v1/library/:bookId')
  @HttpCode(HttpStatus.OK)
  async deleteFromLibrary(
    @Param('bookId') bookId: string,
    @CurrentUser() user: RequestUser,
    @KoboDevice() device: KoboDeviceContext,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const id = await this.bookIdentityService.resolveBookIdByEntitlementId(user.id, bookId);
    if (id === null) return this.proxyService.forward(req, reply, device.deviceToken);
    await this.syncService.removeBookFromSync(user.id, device.deviceId, id);
    reply.status(HttpStatus.OK).send();
  }

  @Get('v1/library/:bookId/state')
  async getReadingState(
    @Param('bookId') bookId: string,
    @CurrentUser() user: RequestUser,
    @KoboDevice() device: KoboDeviceContext,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const id = await this.bookIdentityService.resolveBookIdByEntitlementId(user.id, bookId);
    if (id === null) return this.proxyService.forward(req, reply, device.deviceToken);
    const state = await this.readingStateService.getRawState(user.id, id);
    reply.send(state ? [state] : []);
  }

  @Put('v1/library/:bookId/state')
  @UsePipes(new ValidationPipe({ transform: false, whitelist: false }))
  async updateReadingState(
    @Param('bookId') bookId: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: RequestUser,
    @KoboDevice() device: KoboDeviceContext,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const id = await this.bookIdentityService.resolveBookIdByEntitlementId(user.id, bookId);
    if (id === null) return this.proxyService.forward(req, reply, device.deviceToken);
    const startedAt = Date.now();
    try {
      const settings = await this.settingsService.getSettings(user.id);
      const states = body.ReadingStates as Record<string, unknown>[] | undefined;
      const statePayload = states?.[0] ?? body;
      const result = await this.readingStateService.upsertState(
        user.id,
        id,
        statePayload,
        settings.readingThreshold,
        settings.finishedThreshold,
        settings.twoWayProgressSync,
        device.deviceId,
      );
      await this.historyService.recordSuccess({
        userId: user.id,
        deviceId: device.deviceId,
        event: 'progress_update',
        durationMs: Date.now() - startedAt,
        counts: await this.historyService.countsForBook(user.id, id, { progressUpdates: 1, twoWayProgressSync: settings.twoWayProgressSync }),
      });
      reply.send(result);
    } catch (error: unknown) {
      await this.historyService.recordFailure(
        {
          userId: user.id,
          deviceId: device.deviceId,
          event: 'progress_update',
          durationMs: Date.now() - startedAt,
        },
        error,
      );
      throw error;
    }
  }
}
