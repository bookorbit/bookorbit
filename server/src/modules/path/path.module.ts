import { Module } from '@nestjs/common';

import { PathController } from './path.controller';
import { PathPolicyService } from './path-policy.service';
import { PathService } from './path.service';

@Module({
  controllers: [PathController],
  providers: [PathPolicyService, PathService],
  exports: [PathPolicyService],
})
export class PathModule {}
