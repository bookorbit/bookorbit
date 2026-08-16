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
import { AudiobookshelfApiConnector } from './adapters/audiobookshelf/audiobookshelf-api.connector';
import { AudiobookshelfBackupConnector } from './adapters/audiobookshelf/audiobookshelf-backup.connector';
import { AudiobookshelfNormalizer } from './adapters/audiobookshelf/audiobookshelf-normalizer';
import { AudiobookshelfSourceAdapter } from './adapters/audiobookshelf/audiobookshelf-source.adapter';
import { CalibreWebAutomatedNormalizer } from './adapters/calibre-web-automated/calibre-web-automated-normalizer';
import { CalibreWebAutomatedSnapshotConnector } from './adapters/calibre-web-automated/calibre-web-automated-snapshot.connector';
import { CalibreWebAutomatedSourceAdapter } from './adapters/calibre-web-automated/calibre-web-automated-source.adapter';

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
        AudiobookshelfApiConnector,
        AudiobookshelfBackupConnector,
        AudiobookshelfNormalizer,
        AudiobookshelfSourceAdapter,
        CalibreWebAutomatedSnapshotConnector,
        CalibreWebAutomatedNormalizer,
        CalibreWebAutomatedSourceAdapter,
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
