import { Body, Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';

import type { VisionScanResponse } from '@bookorbit/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { RequireAppAttest } from '../app-attest/app-attest.guard';
import { VISION_SCAN_BODY_LIMIT_BYTES, VisionScanDto } from './dto/vision-scan.dto';
import { VisionScanService } from './vision-scan.service';

/** Each scan is a paid model request, so a burst is limited. */
const SCAN_THROTTLE = { default: { limit: 20, ttl: 60_000 } };

@Controller('mobile/vision-scan')
@RequireAppAttest({ unsignedOutsideProduction: true })
export class VisionScanController {
  constructor(private readonly visionScan: VisionScanService) {}

  /**
   * POST because the photo is a body, not an addressable resource; nothing is stored. An app that
   * gives up drops the request, and the model call is cancelled with it. Not `request.signal`:
   * Fastify aborts that once the body has been read.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @RouteConfig({ bodyLimit: VISION_SCAN_BODY_LIMIT_BYTES })
  @Throttle(SCAN_THROTTLE)
  async scan(
    @Body() dto: VisionScanDto,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<VisionScanResponse> {
    const disconnected = new AbortController();
    const handleClose = () => {
      if (!reply.raw.writableEnded) disconnected.abort();
    };
    reply.raw.on('close', handleClose);
    try {
      return await this.visionScan.scan(user, dto, disconnected.signal);
    } finally {
      reply.raw.off('close', handleClose);
    }
  }
}
