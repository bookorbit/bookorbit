import { Module } from '@nestjs/common';

import { ApiKeyModule } from '../api-key/api-key.module';
import { AuditModule } from '../audit/audit.module';
import { JobsModule } from '../jobs/jobs.module';
import { BulkRunActorService } from './bulk-run-actor.service';
import { BulkRunDispatcher } from './bulk-run-dispatcher.service';
import { BulkRunHandlerRegistry } from './bulk-run-handler.registry';
import { BulkRunJobSource } from './bulk-run-job-source';
import { BulkRunStreams } from './bulk-run-streams.service';
import { BulkRunsRepository } from './bulk-runs.repository';
import { BulkRunsService } from './bulk-runs.service';

/**
 * Bulk actions that outlive the request that started them. Each feature registers a handler for its
 * kind with `BulkRunHandlerRegistry` and starts runs through `BulkRunsService.startAndStream`.
 * `AuthService` comes from the global `AuthModule`; importing it here would close a file-level cycle
 * through `EmailModule` and `BookModule`.
 */
@Module({
  imports: [JobsModule, AuditModule, ApiKeyModule],
  providers: [BulkRunsRepository, BulkRunHandlerRegistry, BulkRunStreams, BulkRunActorService, BulkRunDispatcher, BulkRunsService, BulkRunJobSource],
  exports: [BulkRunsService, BulkRunHandlerRegistry],
})
export class BulkRunsModule {}
