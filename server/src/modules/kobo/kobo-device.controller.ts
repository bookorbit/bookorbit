import { All, Controller, Get, Headers, HttpCode, HttpStatus, Logger, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { Public } from '../../common/decorators/public.decorator';
import { KoboDevice } from './decorators/kobo-device.decorator';
import type { KoboDeviceContext } from './guards/kobo-token.guard';
import { KoboTokenGuard } from './guards/kobo-token.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { KoboThumbnailService } from './services/kobo-thumbnail.service';
import { KoboDownloadService } from './services/kobo-download.service';
import { KoboProxyService } from './services/kobo-proxy.service';

@Controller('kobo/:deviceToken')
@Public()
@UseGuards(KoboTokenGuard)
export class KoboDeviceController {
  private readonly logger = new Logger(KoboDeviceController.name);

  constructor(
    private readonly thumbnailService: KoboThumbnailService,
    private readonly downloadService: KoboDownloadService,
    private readonly proxyService: KoboProxyService,
  ) {}

  @Get('v1/books/:bookId/thumbnail/:width/:height/:quality/:isGreyscale/image.jpg')
  async thumbnailFull(
    @Param('bookId') bookId: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @KoboDevice() device: KoboDeviceContext,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    await this.serveThumbnailOrProxy(bookId, ifNoneMatch, device, req, reply);
  }

  @Get('v1/books/:bookId/thumbnail/:width/:height/false/image.jpg')
  async thumbnailSimple(
    @Param('bookId') bookId: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @KoboDevice() device: KoboDeviceContext,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    await this.serveThumbnailOrProxy(bookId, ifNoneMatch, device, req, reply);
  }

  @Get('v1/books/:bookId/:version/thumbnail/:width/:height/false/image.jpg')
  async thumbnailVersioned(
    @Param('bookId') bookId: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @KoboDevice() device: KoboDeviceContext,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    await this.serveThumbnailOrProxy(bookId, ifNoneMatch, device, req, reply);
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

  @Get('v1/affiliate')
  @HttpCode(HttpStatus.OK)
  affiliate() {
    return {};
  }

  @Get('v1/products/books/series/:seriesId')
  @HttpCode(HttpStatus.OK)
  remainingBookSeries() {
    return { TotalResultCount: 0, SearchResults: [] };
  }

  @Get('v1/products/:productId/nextread')
  @HttpCode(HttpStatus.OK)
  productNextRead() {
    return [];
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

  @All('*')
  async proxy(@KoboDevice() device: KoboDeviceContext, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    this.logger.log(`proxy: ${req.method} ${req.url}`);
    await this.proxyService.forward(req, reply, device.deviceToken);
  }

  private async serveThumbnailOrProxy(
    bookId: string,
    ifNoneMatch: string | undefined,
    device: KoboDeviceContext,
    req: FastifyRequest,
    reply: FastifyReply,
  ) {
    const id = parseInt(bookId, 10);
    if (isNaN(id)) return this.proxyService.forward(req, reply, device.deviceToken);
    await this.thumbnailService.serveThumbnail(id, ifNoneMatch, reply);
  }
}
