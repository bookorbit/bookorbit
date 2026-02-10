import { All, Body, Controller, Delete, Get, Header, Headers, HttpCode, HttpStatus, Param, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { KoboDevice } from './decorators/kobo-device.decorator';
import type { KoboDeviceContext } from './guards/kobo-token.guard';
import { KoboTokenGuard } from './guards/kobo-token.guard';
import { KoboSettingsService } from './services/kobo-settings.service';
import { KoboSyncService } from './services/kobo-sync.service';
import { KoboReadingStateService } from './services/kobo-reading-state.service';
import { KoboThumbnailService } from './services/kobo-thumbnail.service';
import { KoboDownloadService } from './services/kobo-download.service';
import { KoboProxyService } from './services/kobo-proxy.service';

@Controller('kobo/:deviceToken')
@Public()
@UseGuards(KoboTokenGuard)
export class KoboDeviceController {
  constructor(
    private readonly settingsService: KoboSettingsService,
    private readonly syncService: KoboSyncService,
    private readonly readingStateService: KoboReadingStateService,
    private readonly thumbnailService: KoboThumbnailService,
    private readonly downloadService: KoboDownloadService,
    private readonly proxyService: KoboProxyService,
  ) {}

  @Post('v1/auth/device')
  @HttpCode(HttpStatus.CREATED)
  authDevice(@Body() body: Record<string, unknown>) {
    return {
      AccessToken: randomUUID(),
      RefreshToken: randomUUID(),
      TokenType: 'Bearer',
      TrackingId: randomUUID(),
      UserKey: body.UserKey ?? '',
    };
  }

  @Get('v1/initialization')
  @Header('x-kobo-apitoken', 'e30=')
  initialization(@KoboDevice() device: KoboDeviceContext, @Req() req: FastifyRequest) {
    const baseUrl = `${req.protocol}://${req.hostname}`;
    const t = device.deviceToken;
    return {
      Resources: {
        image_host: baseUrl,
        image_url_template: `/api/kobo/${t}/v1/books/{ImageId}/thumbnail/{Width}/{Height}/false/image.jpg`,
        image_url_quality_template: `/api/kobo/${t}/v1/books/{ImageId}/thumbnail/{Width}/{Height}/{Quality}/false/image.jpg`,
        library_sync: `/api/kobo/${t}/v1/library/sync`,
        library_items: `/api/kobo/${t}/v1/library/{RevisionId}`,
        library_metadata: `/api/kobo/${t}/v1/library/{RevisionId}/metadata`,
        library_prices: `/api/kobo/${t}/v1/library/{RevisionId}/prices`,
        library_book_get: `/api/kobo/${t}/v1/library/{RevisionId}`,
        sign_in_page: `${baseUrl}/api/kobo/${t}/v1/signin`,
        userguide_host: `${baseUrl}/api/kobo/${t}`,
        user_loyalty_benefits: `/api/kobo/${t}/v1/user/loyalty/benefits`,
        giftcard_epd_redeem_url: `${baseUrl}/api/kobo/${t}/v1/giftcard/redeem`,
        get_tests_endpoint: `/api/kobo/${t}/v1/analytics/gettests`,
      },
      BookEntitlementsUrl: `/api/kobo/${t}/v1/library/sync`,
    };
  }

  @Post('v1/analytics/gettests')
  @HttpCode(HttpStatus.OK)
  getTests() {
    return { Result: 'Success', TestKey: randomUUID() };
  }

  @Post('v1/analytics/event')
  @HttpCode(HttpStatus.OK)
  analyticsEvent() {
    return {};
  }

  @Get('v1/library/sync')
  async librarySync(
    @KoboDevice() device: KoboDeviceContext,
    @CurrentUser() user: RequestUser,
    @Headers('x-kobo-synctoken') incomingToken: string | undefined,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const baseUrl = `${req.protocol}://${req.hostname}`;
    const settings = await this.settingsService.getSettings(user.id);
    const { entitlements, hasMore, syncToken } = await this.syncService.getDelta(
      user.id,
      device.deviceToken,
      baseUrl,
      incomingToken ?? null,
      settings,
    );

    reply.header('x-kobo-sync', hasMore ? 'continue' : 'done');
    reply.header('x-kobo-synctoken', syncToken);
    reply.send(entitlements);
  }

  @Get('v1/library/:bookId/metadata')
  async getBookMetadata(
    @Param('bookId') bookId: string,
    @CurrentUser() user: RequestUser,
    @KoboDevice() device: KoboDeviceContext,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const id = parseInt(bookId, 10);
    if (isNaN(id)) return this.proxyService.forward(req, reply, device.deviceToken);
    const baseUrl = `${req.protocol}://${req.hostname}`;
    const metadata = await this.syncService.getBookMetadata(user.id, id, device.deviceToken, baseUrl);
    reply.send(metadata);
  }

  @Delete('v1/library/:bookId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteFromLibrary(
    @Param('bookId') bookId: string,
    @CurrentUser() user: RequestUser,
    @KoboDevice() device: KoboDeviceContext,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const id = parseInt(bookId, 10);
    if (isNaN(id)) return this.proxyService.forward(req, reply, device.deviceToken);
    await this.syncService.removeBookFromSync(user.id, id);
    reply.status(HttpStatus.NO_CONTENT).send();
  }

  @Get('v1/library/:bookId/state')
  async getReadingState(
    @Param('bookId') bookId: string,
    @CurrentUser() user: RequestUser,
    @KoboDevice() device: KoboDeviceContext,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const id = parseInt(bookId, 10);
    if (isNaN(id)) return this.proxyService.forward(req, reply, device.deviceToken);
    const state = await this.readingStateService.getRawState(user.id, id);
    reply.send(state);
  }

  @Put('v1/library/:bookId/state')
  async updateReadingState(
    @Param('bookId') bookId: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: RequestUser,
    @KoboDevice() device: KoboDeviceContext,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const id = parseInt(bookId, 10);
    if (isNaN(id)) return this.proxyService.forward(req, reply, device.deviceToken);
    const settings = await this.settingsService.getSettings(user.id);
    const result = await this.readingStateService.upsertState(user.id, id, body, settings.readingThreshold, settings.finishedThreshold);
    reply.send(result);
  }

  @Get('v1/books/:bookId/thumbnail/:width/:height/:quality/:isGreyscale/image.jpg')
  async thumbnailFull(
    @Param('bookId') bookId: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @KoboDevice() device: KoboDeviceContext,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const id = parseInt(bookId, 10);
    if (isNaN(id)) return this.proxyService.forward(req, reply, device.deviceToken);
    await this.thumbnailService.serveThumbnail(id, ifNoneMatch, reply);
  }

  @Get('v1/books/:bookId/thumbnail/:width/:height/false/image.jpg')
  async thumbnailSimple(
    @Param('bookId') bookId: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @KoboDevice() device: KoboDeviceContext,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const id = parseInt(bookId, 10);
    if (isNaN(id)) return this.proxyService.forward(req, reply, device.deviceToken);
    await this.thumbnailService.serveThumbnail(id, ifNoneMatch, reply);
  }

  @Get('v1/books/:bookId/:version/thumbnail/:width/:height/false/image.jpg')
  async thumbnailVersioned(
    @Param('bookId') bookId: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @KoboDevice() device: KoboDeviceContext,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const id = parseInt(bookId, 10);
    if (isNaN(id)) return this.proxyService.forward(req, reply, device.deviceToken);
    await this.thumbnailService.serveThumbnail(id, ifNoneMatch, reply);
  }

  @Get('v1/books/:bookId/download')
  async download(
    @Param('bookId') bookId: string,
    @CurrentUser() user: RequestUser,
    @KoboDevice() device: KoboDeviceContext,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const id = parseInt(bookId, 10);
    if (isNaN(id)) return this.proxyService.forward(req, reply, device.deviceToken);
    await this.downloadService.streamBook(user.id, id, reply);
  }

  @All('*')
  async proxy(@KoboDevice() device: KoboDeviceContext, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    await this.proxyService.forward(req, reply, device.deviceToken);
  }
}
