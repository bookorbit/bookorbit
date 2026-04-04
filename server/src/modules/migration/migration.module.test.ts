import { MODULE_METADATA } from '@nestjs/common/constants';

import { MigrationController } from './migration.controller';
import { MigrationModule } from './migration.module';
import { MigrationRepository } from './migration.repository';
import { MigrationService } from './migration.service';
import { SourceAdapterRegistry } from './adapters/source-adapter.registry';
import { MigrationPlannerService } from './planner/planner.service';
import { PathMappingValidationService } from './planner/path-mapping-validation.service';
import { MigrationExecutorService } from './executor/migration-executor.service';
import { MigrationReportingService } from './reporting/migration-reporting.service';

describe('MigrationModule', () => {
  it('registers expected controllers and providers', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, MigrationModule);
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, MigrationModule);
    const exports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, MigrationModule);

    expect(controllers).toEqual(expect.arrayContaining([MigrationController]));
    expect(providers).toEqual(
      expect.arrayContaining([
        MigrationRepository,
        SourceAdapterRegistry,
        MigrationPlannerService,
        PathMappingValidationService,
        MigrationExecutorService,
        MigrationReportingService,
        MigrationService,
      ]),
    );
    expect(exports).toEqual(expect.arrayContaining([MigrationRepository, MigrationService]));
  });
});
