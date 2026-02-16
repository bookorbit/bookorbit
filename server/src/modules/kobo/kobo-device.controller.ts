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
import { KOBO_STORE_RESOURCES } from './kobo-store-resources';

function buildBaseUrl(req: FastifyRequest): string {
  const hasForwarded = req.headers['x-forwarded-host'] || req.headers['x-forwarded-port'] || req.headers['x-forwarded-proto'];
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol;
  const headerHost = req.headers['x-forwarded-host'] ?? req.headers.host;
  let host = headerHost ? (Array.isArray(headerHost) ? headerHost[0] : headerHost) : req.hostname;

  if (!hasForwarded && !host.includes(':')) {
    const localPort = req.socket?.localPort;
    const isDefault = (proto === 'http' && localPort === 80) || (proto === 'https' && localPort === 443);
    if (localPort && !isDefault) {
      host = host + ':' + String(localPort);
    }
  }

  return proto + '://' + host;
}

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
  @HttpCode(HttpStatus.OK)
  authDevice(@Body() body: Record<string, unknown>) {
    return {
      AccessToken: randomUUID(),
      RefreshToken: randomUUID(),
      TokenType: 'Bearer',
      TrackingId: randomUUID(),
      UserKey: body.UserKey ?? '',
    };
  }

  @Post('v1/auth/refresh')
  @HttpCode(HttpStatus.OK)
  authRefresh(@Body() body: Record<string, unknown>) {
    return {
      AccessToken: randomUUID(),
      RefreshToken: body.RefreshToken ?? randomUUID(),
      TokenType: 'Bearer',
      TrackingId: randomUUID(),
    };
  }

  @Get('v1/initialization')
  @Header('x-kobo-apitoken', 'e30=')
  initialization(@KoboDevice() device: KoboDeviceContext, @Req() req: FastifyRequest) {
    const baseUrl = buildBaseUrl(req);
    const t = device.deviceToken;
    const resources = {
      ...KOBO_STORE_RESOURCES,
      image_host: baseUrl,
      image_url_template: `${baseUrl}/api/kobo/${t}/v1/books/{ImageId}/thumbnail/{Width}/{Height}/false/image.jpg`,
      image_url_quality_template: `${baseUrl}/api/kobo/${t}/v1/books/{ImageId}/thumbnail/{Width}/{Height}/{Quality}/{IsGreyscale}/image.jpg`,
      library_sync: `${baseUrl}/api/kobo/${t}/v1/library/sync`,
    };
    return { Resources: resources };
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
    const baseUrl = buildBaseUrl(req);
    const settings = await this.settingsService.getSettings(user.id);
    const { entitlements, hasMore, syncToken } = await this.syncService.getDelta(
      user.id,
      device.deviceToken,
      baseUrl,
      incomingToken ?? null,
      settings,
    );

    reply.header('x-kobo-sync', hasMore ? 'continue' : '');
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
    const id = parseInt(bookId, 10);
    if (isNaN(id)) return this.proxyService.forward(req, reply, device.deviceToken);
    await this.syncService.removeBookFromSync(user.id, id);
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
    const id = parseInt(bookId, 10);
    if (isNaN(id)) return this.proxyService.forward(req, reply, device.deviceToken);
    const state = await this.readingStateService.getRawState(user.id, id);
    reply.send(state ? [state] : []);
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
    const states = body.ReadingStates as Record<string, unknown>[] | undefined;
    const statePayload = states?.[0] ?? body;
    const settings = await this.settingsService.getSettings(user.id);
    const result = await this.readingStateService.upsertState(user.id, id, statePayload, settings.readingThreshold, settings.finishedThreshold);
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
