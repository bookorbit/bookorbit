import { Body, Controller, Get, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { AppAttestService } from './app-attest.service';
import { RegisterAppAttestKeyDto } from './dto/register-app-attest-key.dto';

const ONE_MINUTE_MS = 60_000;

@Controller('app-attest')
export class AppAttestController {
  constructor(private readonly appAttest: AppAttestService) {}

  @Post('challenges')
  @Throttle({ default: { limit: 10, ttl: ONE_MINUTE_MS } })
  createChallenge(@CurrentUser() user: RequestUser) {
    return this.appAttest.issueChallenge(user);
  }

  @Get('keys')
  listKeys(@CurrentUser() user: RequestUser) {
    return this.appAttest.listKeys(user);
  }

  @Post('keys')
  @Throttle({ default: { limit: 10, ttl: ONE_MINUTE_MS } })
  registerKey(@CurrentUser() user: RequestUser, @Body() dto: RegisterAppAttestKeyDto) {
    return this.appAttest.registerKey(user, dto);
  }
}
