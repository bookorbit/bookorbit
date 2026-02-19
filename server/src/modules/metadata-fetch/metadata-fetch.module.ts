import { Module } from '@nestjs/common';

import { METADATA_PROVIDERS } from './constants';
import { MetadataFetchController } from './metadata-fetch.controller';
import { MetadataFetchService } from './metadata-fetch.service';
import { ProviderRegistry } from './provider-registry';
import { GoogleProvider } from './providers/google/google.provider';
import { OpenLibraryProvider } from './providers/open-library/open-library.provider';

const PROVIDER_CLASSES = [GoogleProvider, OpenLibraryProvider];

@Module({
  providers: [
    ...PROVIDER_CLASSES,
    ...PROVIDER_CLASSES.map((cls) => ({
      provide: METADATA_PROVIDERS,
      useExisting: cls,
      multi: true,
    })),
    ProviderRegistry,
    MetadataFetchService,
  ],
  controllers: [MetadataFetchController],
})
export class MetadataFetchModule {}
