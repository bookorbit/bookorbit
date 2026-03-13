import { Body, Controller, Delete, Get, Header, Headers, HttpCode, HttpStatus, Logger, Param, Put, Req, Res, UseGuards } from '@nestjs/common';
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
import { KoboProxyService } from './services/kobo-proxy.service';
import { KOBO_STORE_RESOURCES } from './kobo-store-resources';

function buildBaseUrl(req: FastifyRequest): string {
  const fwdHost = req.headers['x-forwarded-host'];
  const fwdPort = req.headers['x-forwarded-port'];
  const fwdProto = req.headers['x-forwarded-proto'];
  const hasForwarded = fwdHost || fwdPort || fwdProto;
  const proto = (fwdProto as string | undefined) ?? req.protocol;
  const headerHost = fwdHost ?? req.headers.host;
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
export class KoboSyncController {
  private readonly logger = new Logger(KoboSyncController.name);

  constructor(
    private readonly settingsService: KoboSettingsService,
    private readonly syncService: KoboSyncService,
    private readonly readingStateService: KoboReadingStateService,
    private readonly proxyService: KoboProxyService,
  ) {}

  @Get('v1/initialization')
  @Header('x-kobo-apitoken', 'e30=')
  initialization(@KoboDevice() device: KoboDeviceContext, @Req() req: FastifyRequest) {
    const baseUrl = buildBaseUrl(req);
    const t = device.deviceToken;
    return {
      Resources: {
        ...KOBO_STORE_RESOURCES,
        image_host: baseUrl,
        image_url_template: `${baseUrl}/api/v1/kobo/${t}/v1/books/{ImageId}/thumbnail/{Width}/{Height}/false/image.jpg`,
        image_url_quality_template: `${baseUrl}/api/v1/kobo/${t}/v1/books/{ImageId}/thumbnail/{Width}/{Height}/{Quality}/{IsGreyscale}/image.jpg`,
        library_sync: `${baseUrl}/api/v1/kobo/${t}/v1/library/sync`,
      },
    };
  }

  @Get('v1/library/sync')
  async librarySync(
    @KoboDevice() device: KoboDeviceContext,
    @CurrentUser() user: RequestUser,
    @Headers('x-kobo-synctoken') incomingToken: string | undefined,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    this.logger.log(`librarySync: userId=${user.id} syncToken=${incomingToken ?? 'none'}`);
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
}
