import { Module } from '@nestjs/common';

import { JobChangesService } from './job-changes.service';
import { JobSourceRegistry } from './job-source.registry';
import { JobsController } from './jobs.controller';
import { JobsGateway } from './jobs.gateway';
import { JobsService } from './jobs.service';

/**
 * The Jobs area. It imports no feature module: each feature imports this one, defines its adapter
 * next to its own repository, registers it with `JobSourceRegistry` on init, and reports changes
 * through `JobChangesService`.
 */
@Module({
  controllers: [JobsController],
  providers: [JobChangesService, JobSourceRegistry, JobsGateway, JobsService],
  exports: [JobChangesService, JobSourceRegistry],
})
export class JobsModule {}
