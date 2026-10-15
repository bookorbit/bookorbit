import { Controller, Get, Header } from '@nestjs/common';
import type { ServerIdentityResponse } from '@bookorbit/types';

import { Public } from '../../common/decorators/public.decorator';
import { ServerIdentityService } from './server-identity.service';

@Controller('server-identity')
export class ServerIdentityController {
  constructor(private readonly service: ServerIdentityService) {}

  @Get()
  @Public()
  @Header('Cache-Control', 'no-store')
  getIdentity(): Promise<ServerIdentityResponse> {
    return this.service.getIdentity();
  }
}
