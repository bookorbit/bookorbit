import { Module } from '@nestjs/common';

import { METADATA_PROVIDERS } from './constants';
import { MetadataFetchController } from './metadata-fetch.controller';
import { MetadataProvider } from './providers/metadata-provider';
import { MetadataFetchService } from './metadata-fetch.service';
import { ProviderRegistry } from './provider-registry';
import { AmazonProvider } from './providers/amazon/amazon.provider';
import { GoogleProvider } from './providers/google/google.provider';
import { GoodreadsProvider } from './providers/goodreads/goodreads.provider';
import { OpenLibraryProvider } from './providers/open-library/open-library.provider';

const PROVIDER_CLASSES = [GoogleProvider, GoodreadsProvider, AmazonProvider, OpenLibraryProvider];

@Module({
  providers: [
    ...PROVIDER_CLASSES,
    {
      provide: METADATA_PROVIDERS,
      useFactory: (...providers: MetadataProvider[]) => providers,
      inject: PROVIDER_CLASSES,
    },
    ProviderRegistry,
    MetadataFetchService,
  ],
  controllers: [MetadataFetchController],
})
export class MetadataFetchModule {}
