import { Module } from '@nestjs/common';

import { MetadataPreferencesModule } from '../metadata-preferences/metadata-preferences.module';
import { METADATA_PROVIDERS } from './constants';
import { MetadataFetchController } from './metadata-fetch.controller';
import { MetadataFetchPipeline } from './metadata-fetch-pipeline';
import { MetadataProvider } from './providers/metadata-provider';
import { MetadataFetchService } from './metadata-fetch.service';
import { ProviderRegistry } from './provider-registry';
import { AmazonProvider } from './providers/amazon/amazon.provider';
import { GoogleProvider } from './providers/google/google.provider';
import { GoodreadsProvider } from './providers/goodreads/goodreads.provider';
import { OpenLibraryProvider } from './providers/open-library/open-library.provider';
import { ITunesProvider } from './providers/itunes/itunes.provider';

const PROVIDER_CLASSES = [GoogleProvider, GoodreadsProvider, AmazonProvider, OpenLibraryProvider, ITunesProvider];

@Module({
  imports: [MetadataPreferencesModule],
  providers: [
    ...PROVIDER_CLASSES,
    {
      provide: METADATA_PROVIDERS,
      useFactory: (...providers: MetadataProvider[]) => providers,
      inject: PROVIDER_CLASSES,
    },
    ProviderRegistry,
    MetadataFetchService,
    MetadataFetchPipeline,
  ],
  controllers: [MetadataFetchController],
  exports: [MetadataFetchService, MetadataFetchPipeline, ProviderRegistry],
})
export class MetadataFetchModule {}
