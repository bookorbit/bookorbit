import {
  All,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
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
import { KoboAnnotationExchangeService, KoboContentNotFoundException } from './services/kobo-annotation-exchange.service';
import { KoboSyncHistoryService } from './services/kobo-sync-history.service';
import { KoboProxyService } from './services/kobo-proxy.service';
import { KoboSettingsService } from './services/kobo-settings.service';

@Controller(['kobo/:deviceToken', ''])
@Public()
@UseGuards(KoboTokenGuard)
export class KoboReadingServicesController {
  constructor(
    private readonly exchangeService: KoboAnnotationExchangeService,
    private readonly historyService: KoboSyncHistoryService,
    private readonly proxyService: KoboProxyService,
    private readonly settingsService: KoboSettingsService,
  ) {}

  @Get('api/v3/content/:contentId/annotations')
  async getAnnotations(
    @Param('contentId') contentId: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @CurrentUser() user: RequestUser,
    @KoboDevice() device: KoboDeviceContext,
    @Res() reply: FastifyReply,
  ) {
    const startedAt = Date.now();
    let result: Awaited<ReturnType<KoboAnnotationExchangeService['getContentAnnotations']>>;
    try {
      result = await this.exchangeService.getContentAnnotations(user.id, contentId, device.deviceId, ifNoneMatch);
      await this.historyService.recordSuccess({
        userId: user.id,
        deviceId: device.deviceId,
        event: 'annotations_pull',
        durationMs: Date.now() - startedAt,
        counts: await this.historyService.countsForBook(user.id, result.bookId, {
          served: result.servedCount,
          tombstones: result.tombstoneCount,
          notModified: result.notModified,
        }),
      });
    } catch (error: unknown) {
      if (!(error instanceof KoboContentNotFoundException)) {
        await this.historyService.recordFailure(
          {
            userId: user.id,
            deviceId: device.deviceId,
            event: 'annotations_pull',
            durationMs: Date.now() - startedAt,
          },
          error,
        );
      }
      throw error;
    }
    reply.header('ETag', result.etag);

    if (result.notModified) {
      await this.exchangeService.markServedSeen(user.id, device.deviceId, result.servedAck);
      reply.status(HttpStatus.NOT_MODIFIED).send();
      return;
    }
    await this.exchangeService.rememberServe(user.id, device.deviceId, result.bookId, result.etag, result.servedAck);
    reply.send(result.response);
  }

  @Patch('api/v3/content/:contentId/annotations')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UsePipes(new ValidationPipe({ transform: false, whitelist: false }))
  async patchAnnotations(
    @Param('contentId') contentId: string,
    @Body() body: unknown,
    @CurrentUser() user: RequestUser,
    @KoboDevice() device: KoboDeviceContext,
  ) {
    const startedAt = Date.now();
    try {
      const result = await this.exchangeService.patchContentAnnotations(user.id, contentId, body, device.deviceId);
      await this.historyService.recordSuccess({
        userId: user.id,
        deviceId: device.deviceId,
        event: 'annotations_push',
        durationMs: Date.now() - startedAt,
        counts: await this.historyService.countsForBook(user.id, result.bookId, {
          created: result.created,
          updated: result.updated,
          unchanged: result.unchanged,
          deleted: result.deleted,
          kepubReady: result.kepubReady,
        }),
      });
    } catch (error: unknown) {
      if (!(error instanceof KoboContentNotFoundException)) {
        await this.historyService.recordFailure(
          {
            userId: user.id,
            deviceId: device.deviceId,
            event: 'annotations_push',
            durationMs: Date.now() - startedAt,
          },
          error,
        );
      }
      throw error;
    }
  }

  @Post('api/v3/content/checkforchanges')
  @HttpCode(HttpStatus.OK)
  async checkForChanges(@Body() body: unknown, @CurrentUser() user: RequestUser, @KoboDevice() device: KoboDeviceContext) {
    return this.exchangeService.getChangedContentIds(user.id, device.deviceId, body);
  }

  /**
   * Notebooks sync through Kobo's own UserStorage service, which BookOrbit does not hold. With store titles
   * on, the device is signed in to Kobo and already talks to it for its store library, so its notebook
   * calls are relayed there too. Otherwise an empty listing keeps the device's notebook sync quiet.
   */
  @All('api/UserStorage/*')
  async userStorage(
    @CurrentUser() user: RequestUser,
    @KoboDevice() device: KoboDeviceContext,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const storeSync = await this.settingsService
      .getSettings(user.id)
      .then((settings) => settings.storeSync)
      .catch(() => false);
    if (storeSync) return this.proxyService.forward(req, reply, device.deviceToken, 'readingServices');
    if (req.method === 'GET' && req.url.split('?')[0].endsWith('/api/UserStorage/Metadata')) {
      reply.send({ continuationToken: null, metadata: [] });
      return;
    }
    throw new NotFoundException();
  }
}
