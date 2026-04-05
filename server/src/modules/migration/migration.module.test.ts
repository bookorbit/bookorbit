import { MODULE_METADATA } from '@nestjs/common/constants';

import { MigrationController } from './migration.controller';
import { MigrationProgressGateway } from './migration-progress.gateway';
import { MigrationModule } from './migration.module';
import { MigrationRepository } from './migration.repository';
import { MigrationSourceService } from './migration-source.service';
import { MigrationProfileService } from './migration-profile.service';
import { MigrationService } from './migration.service';
import { MigrationEncryptionService } from './core/migration-encryption.service';
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
        MigrationEncryptionService,
        SourceAdapterRegistry,
        MigrationPlannerService,
        PathMappingValidationService,
        MigrationExecutorService,
        MigrationReportingService,
        MigrationSourceService,
        MigrationProfileService,
        MigrationService,
        MigrationProgressGateway,
      ]),
    );
    expect(exports).toEqual(expect.arrayContaining([MigrationRepository, MigrationService]));
  });
});
