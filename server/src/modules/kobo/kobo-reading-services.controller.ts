import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Patch, Post, Res, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { KoboDevice } from './decorators/kobo-device.decorator';
import type { KoboDeviceContext } from './guards/kobo-token.guard';
import { KoboTokenGuard } from './guards/kobo-token.guard';
import { KoboAnnotationExchangeService } from './services/kobo-annotation-exchange.service';
import { KoboSyncHistoryService } from './services/kobo-sync-history.service';

@Controller(['kobo/:deviceToken', ''])
@Public()
@UseGuards(KoboTokenGuard)
export class KoboReadingServicesController {
  constructor(
    private readonly exchangeService: KoboAnnotationExchangeService,
    private readonly historyService: KoboSyncHistoryService,
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
      await this.historyService.recordFailure(
        {
          userId: user.id,
          deviceId: device.deviceId,
          event: 'annotations_pull',
          durationMs: Date.now() - startedAt,
        },
        error,
      );
      throw error;
    }
    reply.header('ETag', result.etag);

    // This Kobo firmware never echoes our ETag back (it always sends If-None-Match: W/"0" and drives
    // sync via checkforchanges), so the 304 path is never reached. Mark the content seen once the
    // response is flushed on both 200 and 304, otherwise checkforchanges reports every annotated book
    // as changed on every sync and the device never converges (downloads run detached and never apply).
    reply.raw.once('finish', () => {
      void this.exchangeService.markServedSeen(user.id, device.deviceId, result.servedAck).catch(() => undefined);
    });

    if (result.notModified) {
      reply.status(HttpStatus.NOT_MODIFIED).send();
      return;
    }
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
      await this.historyService.recordFailure(
        {
          userId: user.id,
          deviceId: device.deviceId,
          event: 'annotations_push',
          durationMs: Date.now() - startedAt,
        },
        error,
      );
      throw error;
    }
  }

  @Post('api/v3/content/checkforchanges')
  @HttpCode(HttpStatus.OK)
  async checkForChanges(@CurrentUser() user: RequestUser, @KoboDevice() device: KoboDeviceContext) {
    return this.exchangeService.getChangedContentIds(user.id, device.deviceId);
  }

  @Get('api/UserStorage/Metadata')
  getUserStorageMetadata() {
    return { continuationToken: null, metadata: [] };
  }
}
