import { Module } from '@nestjs/common';

import { MigrationController } from './migration.controller';
import { MigrationRepository } from './migration.repository';
import { MigrationService } from './migration.service';
import { SourceAdapterRegistry } from './adapters/source-adapter.registry';
import { BookloreSourceAdapter } from './adapters/booklore/booklore-source.adapter';
import { BookloreConnector } from './adapters/booklore/booklore-connector';
import { MatchingService } from './planner/matching.service';
import { MigrationPlannerService } from './planner/planner.service';
import { PathMappingValidationService } from './planner/path-mapping-validation.service';
import { MigrationExecutorService } from './executor/migration-executor.service';
import { MigrationReportingService } from './reporting/migration-reporting.service';

@Module({
  controllers: [MigrationController],
  providers: [
    MigrationRepository,
    BookloreConnector,
    BookloreSourceAdapter,
    SourceAdapterRegistry,
    MatchingService,
    MigrationPlannerService,
    PathMappingValidationService,
    MigrationExecutorService,
    MigrationReportingService,
    MigrationService,
  ],
  exports: [MigrationRepository, MigrationService],
})
export class MigrationModule {}
