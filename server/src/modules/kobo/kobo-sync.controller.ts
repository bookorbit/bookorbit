import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
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
import { KoboDevice } from './decorators/kobo-device.decorator';
import type { KoboDeviceContext } from './guards/kobo-token.guard';
import { KoboTokenGuard } from './guards/kobo-token.guard';
import { KoboSettingsService } from './services/kobo-settings.service';
import { KoboSyncService } from './services/kobo-sync.service';
import { KoboReadingStateService } from './services/kobo-reading-state.service';
import { KoboProxyService } from './services/kobo-proxy.service';
import { KOBO_STORE_RESOURCES } from './kobo-store-resources';
import { KoboBookIdentityService } from './services/kobo-book-identity.service';

function readHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
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
        reading_services_host: readingServicesBaseUrl,
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
    const { entitlements, hasMore, syncToken } = await this.syncService.getDelta(user.id, device.deviceToken, baseUrl);
    reply.header('x-kobo-sync', hasMore ? 'continue' : '');
    reply.header('x-kobo-synctoken', syncToken);
    reply.send(entitlements);
  }

  @Post('v1/library/tags/:tagId/items/delete')
  @HttpCode(HttpStatus.OK)
  async deleteTagItems(
    @Param('tagId') tagId: string,
    @KoboDevice() device: KoboDeviceContext,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    if (!tagId.startsWith('col-')) return this.proxyService.forward(req, reply, device.deviceToken);
    reply.status(HttpStatus.OK).send({ RequestResult: 'Success' });
  }

  @Post('v1/library/tags/:tagId/items')
  @HttpCode(HttpStatus.OK)
  async addTagItems(@Param('tagId') tagId: string, @KoboDevice() device: KoboDeviceContext, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    if (!tagId.startsWith('col-')) return this.proxyService.forward(req, reply, device.deviceToken);
    reply.status(HttpStatus.OK).send({ RequestResult: 'Success' });
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
    );
    reply.send(result);
  }
}
