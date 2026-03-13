import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { randomUUID } from 'crypto';

import { Public } from '../../common/decorators/public.decorator';
import { KoboTokenGuard } from './guards/kobo-token.guard';

@Controller('kobo/:deviceToken')
@Public()
@UseGuards(KoboTokenGuard)
export class KoboAuthController {
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
}
