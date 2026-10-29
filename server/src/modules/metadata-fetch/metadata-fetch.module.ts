import { Module } from '@nestjs/common';

import { MetadataCacheModule } from '../metadata-cache/metadata-cache.module';
import { MetadataHttpProviderModule } from '../metadata-http-provider/metadata-http-provider.module';
import { MetadataPreferencesModule } from '../metadata-preferences/metadata-preferences.module';
import { BookProviderCacheRegistrar } from './book-provider-cache.registrar';
import { METADATA_PROVIDERS } from './constants';
import { MetadataFetchController } from './metadata-fetch.controller';
import { MetadataFetchPipeline } from './metadata-fetch-pipeline';
import { MetadataProvider } from './providers/metadata-provider';
import { MetadataFetchService } from './metadata-fetch.service';
import { MetadataFetchRepository } from './metadata-fetch.repository';
import { ProviderIdRepository } from './provider-ids/provider-id.repository';
import { ProviderIdStore } from './provider-ids/provider-id.store';
import { ProviderRegistry } from './provider-registry';
import { ProviderThrottleTracker } from './provider-throttle.tracker';
import { AmazonProvider } from './providers/amazon/amazon.provider';
import { GoogleProvider } from './providers/google/google.provider';
import { GoodreadsProvider } from './providers/goodreads/goodreads.provider';
import { OpenLibraryProvider } from './providers/open-library/open-library.provider';
import { ITunesProvider } from './providers/itunes/itunes.provider';
import { AudibleProvider } from './providers/audible/audible.provider';
import { AudnexusProvider } from './providers/audnexus/audnexus.provider';
import { LibroFmProvider } from './providers/librofm/librofm.provider';
import { HardcoverClient } from './providers/hardcover/hardcover.client';
import { HardcoverProvider } from './providers/hardcover/hardcover.provider';
import { ComicVineClient } from './providers/comicvine/comicvine.client';
import { ComicVineProvider } from './providers/comicvine/comicvine.provider';
import { KoboProvider } from './providers/kobo/kobo.provider';
import { RanobeDbClient } from './providers/ranobedb/ranobedb.client';
import { RanobeDbProvider } from './providers/ranobedb/ranobedb.provider';

const PROVIDER_CLASSES = [
  GoogleProvider,
  GoodreadsProvider,
  AmazonProvider,
  OpenLibraryProvider,
  ITunesProvider,
  AudibleProvider,
  AudnexusProvider,
  LibroFmProvider,
  HardcoverProvider,
  ComicVineProvider,
  RanobeDbProvider,
  KoboProvider,
];

@Module({
  imports: [MetadataPreferencesModule, MetadataCacheModule, MetadataHttpProviderModule],
  providers: [
    ...PROVIDER_CLASSES,
    {
      provide: METADATA_PROVIDERS,
      useFactory: (...providers: MetadataProvider[]) => providers,
      inject: PROVIDER_CLASSES,
    },
    HardcoverClient,
    ComicVineClient,
    RanobeDbClient,
    ProviderRegistry,
    ProviderThrottleTracker,
    MetadataFetchRepository,
    ProviderIdRepository,
    ProviderIdStore,
    MetadataFetchService,
    MetadataFetchPipeline,
    BookProviderCacheRegistrar,
  ],
  controllers: [MetadataFetchController],
  exports: [MetadataFetchService, MetadataFetchPipeline, ProviderRegistry, ProviderThrottleTracker, ProviderIdStore],
})
export class MetadataFetchModule {}
