import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { randomUUID } from 'crypto';

import { Public } from '../../common/decorators/public.decorator';
import { KoboTokenGuard } from './guards/kobo-token.guard';

type KoboAuthBody = Record<string, unknown>;

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

@Controller('kobo/:deviceToken')
@Public()
@UseGuards(KoboTokenGuard)
export class KoboAuthController {
  @Post('v1/auth/device')
  @HttpCode(HttpStatus.OK)
  authDevice(@Body() body: KoboAuthBody = {}) {
    return {
      AccessToken: randomUUID(),
      RefreshToken: randomUUID(),
      TokenType: 'Bearer',
      TrackingId: randomUUID(),
      UserKey: optionalString(body.UserKey) ?? '',
    };
  }

  @Post('v1/auth/refresh')
  @HttpCode(HttpStatus.OK)
  authRefresh(@Body() body: KoboAuthBody = {}) {
    return {
      AccessToken: randomUUID(),
      RefreshToken: optionalString(body.RefreshToken) ?? randomUUID(),
      TokenType: 'Bearer',
      TrackingId: randomUUID(),
    };
  }
}
