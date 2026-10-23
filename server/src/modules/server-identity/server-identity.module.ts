import { Module } from '@nestjs/common';

import { ServerIdentityController } from './server-identity.controller';
import { ServerIdentityRepository } from './server-identity.repository';
import { ServerIdentityService } from './server-identity.service';

@Module({
  controllers: [ServerIdentityController],
  providers: [ServerIdentityRepository, ServerIdentityService],
  exports: [ServerIdentityService],
})
export class ServerIdentityModule {}
