import { Module } from '@nestjs/common';

import { MetadataCacheAdminService } from './metadata-cache-admin.service';
import { MetadataCacheConfigService } from './metadata-cache-config.service';
import { MetadataCacheController } from './metadata-cache.controller';
import { MetadataCacheDb } from './metadata-cache.db';
import { MetadataCacheProviderCatalog } from './metadata-cache-provider-catalog';
import { MetadataCacheRepository } from './metadata-cache.repository';
import { MetadataCacheSettingsRepository } from './metadata-cache-settings.repository';
import { MetadataCacheAccessTracker, MetadataCacheBudget, MetadataCacheCounterService } from './metadata-cache-state';
import { MetadataCacheSweeper } from './metadata-cache-sweeper.service';
import { ProviderOperationExecutor } from './provider-operation-executor.service';

@Module({
  providers: [
    MetadataCacheDb,
    MetadataCacheRepository,
    MetadataCacheSettingsRepository,
    MetadataCacheProviderCatalog,
    MetadataCacheConfigService,
    MetadataCacheCounterService,
    MetadataCacheBudget,
    MetadataCacheAccessTracker,
    MetadataCacheSweeper,
    ProviderOperationExecutor,
    MetadataCacheAdminService,
  ],
  controllers: [MetadataCacheController],
  exports: [ProviderOperationExecutor, MetadataCacheProviderCatalog],
})
export class MetadataCacheModule {}
