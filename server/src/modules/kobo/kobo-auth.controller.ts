import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { randomUUID } from 'crypto';

import { Public } from '../../common/decorators/public.decorator';
import { KoboTokenGuard } from './guards/kobo-token.guard';
import { KoboAuthDeviceBodyDto } from './dto/kobo-auth-device-body.dto';
import { KoboAuthRefreshBodyDto } from './dto/kobo-auth-refresh-body.dto';

@Controller('kobo/:deviceToken')
@Public()
@UseGuards(KoboTokenGuard)
export class KoboAuthController {
  @Post('v1/auth/device')
  @HttpCode(HttpStatus.OK)
  authDevice(@Body() body: KoboAuthDeviceBodyDto) {
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
  authRefresh(@Body() body: KoboAuthRefreshBodyDto) {
    return {
      AccessToken: randomUUID(),
      RefreshToken: body.RefreshToken ?? randomUUID(),
      TokenType: 'Bearer',
      TrackingId: randomUUID(),
    };
  }
}
