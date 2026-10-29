import { Module } from '@nestjs/common';

import { HttpProviderClient } from './http-provider.client';
import { MetadataHttpProviderCatalog } from './metadata-http-provider.catalog';
import { MetadataHttpProviderController } from './metadata-http-provider.controller';
import { MetadataHttpProviderRepository } from './metadata-http-provider.repository';
import { MetadataHttpProviderSecrets } from './metadata-http-provider-secrets.service';
import { MetadataHttpProviderService } from './metadata-http-provider.service';
import { MetadataProviderDirectoryService } from './metadata-provider-directory.service';
import { MetadataProviderIconController } from './metadata-provider-icon.controller';

/**
 * External metadata providers. Depends on nothing but the database and config, so the metadata
 * fetch and preference modules can both read its catalog without a cycle.
 */
@Module({
  providers: [
    MetadataHttpProviderRepository,
    MetadataHttpProviderSecrets,
    MetadataHttpProviderCatalog,
    HttpProviderClient,
    MetadataHttpProviderService,
    MetadataProviderDirectoryService,
  ],
  controllers: [MetadataHttpProviderController, MetadataProviderIconController],
  exports: [MetadataHttpProviderCatalog, HttpProviderClient],
})
export class MetadataHttpProviderModule {}
