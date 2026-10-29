import { Module } from '@nestjs/common';

import { FolderInsightService } from './folder-insight.service';
import { PathController } from './path.controller';
import { PathPolicyService } from './path-policy.service';
import { PathRepository } from './path.repository';
import { PathService } from './path.service';

@Module({
  controllers: [PathController],
  providers: [PathPolicyService, PathService, PathRepository, FolderInsightService],
  exports: [PathPolicyService],
})
export class PathModule {}
