import { Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { StringValue } from 'ms';

import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';
import { ScannerModule } from '../scanner/scanner.module';
import { MigrationController } from './migration.controller';
import { MigrationProgressGateway } from './migration-progress.gateway';
import { MigrationRepository } from './migration.repository';
import { MigrationSourceService } from './migration-source.service';
import { MigrationProfileService } from './migration-profile.service';
import { MigrationService } from './migration.service';
import { MigrationEncryptionService } from './core/migration-encryption.service';
import { SourceAdapterRegistry } from './adapters/source-adapter.registry';
import { BookloreSourceAdapter } from './adapters/booklore/booklore-source.adapter';
import { BookloreConnector } from './adapters/booklore/booklore-connector';
import { GrimmorySourceAdapter } from './adapters/grimmory/grimmory-source.adapter';
import { MatchingService } from './planner/matching.service';
import { MigrationPlannerService } from './planner/planner.service';
import { PathMappingValidationService } from './planner/path-mapping-validation.service';
import { MigrationImportRepository } from './executor/migration-import.repository';
import { SharedOverlaysImporter } from './executor/shared-overlays.importer';
import { CoverImporter } from './executor/cover.importer';
import { UserStateImporter } from './executor/user-state.importer';
import { MigrationExecutorService } from './executor/migration-executor.service';
import { MigrationReportingService } from './reporting/migration-reporting.service';

@Module({
  imports: [
    AuthModule,
    forwardRef(() => NotificationModule),
    ScannerModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('auth.jwtSecret'),
        signOptions: { expiresIn: config.getOrThrow<StringValue | number>('auth.jwtExpiresIn') },
      }),
    }),
  ],
  controllers: [MigrationController],
  providers: [
    MigrationRepository,
    MigrationImportRepository,
    MigrationEncryptionService,
    BookloreConnector,
    BookloreSourceAdapter,
    GrimmorySourceAdapter,
    SourceAdapterRegistry,
    MatchingService,
    MigrationPlannerService,
    PathMappingValidationService,
    SharedOverlaysImporter,
    CoverImporter,
    UserStateImporter,
    MigrationExecutorService,
    MigrationReportingService,
    MigrationSourceService,
    MigrationProfileService,
    MigrationService,
    MigrationProgressGateway,
  ],
  exports: [MigrationRepository, MigrationService],
})
export class MigrationModule {}
