import { MODULE_METADATA } from '@nestjs/common/constants';

import { MetadataPreferencesModule } from '../metadata-preferences/metadata-preferences.module';
import { METADATA_PROVIDERS } from './constants';
import { MetadataFetchController } from './metadata-fetch.controller';
import { MetadataFetchModule } from './metadata-fetch.module';
import { MetadataFetchPipeline } from './metadata-fetch-pipeline';
import { MetadataFetchService } from './metadata-fetch.service';
import { ProviderRegistry } from './provider-registry';
import { AmazonProvider } from './providers/amazon/amazon.provider';
import { GoodreadsProvider } from './providers/goodreads/goodreads.provider';
import { GoogleProvider } from './providers/google/google.provider';
import { OpenLibraryProvider } from './providers/open-library/open-library.provider';

describe('MetadataFetchModule', () => {
  it('registers provider classes and factory wiring for METADATA_PROVIDERS', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, MetadataFetchModule) as unknown[];

    expect(providers).toEqual(
      expect.arrayContaining([
        GoogleProvider,
        GoodreadsProvider,
        AmazonProvider,
        OpenLibraryProvider,
        ProviderRegistry,
        MetadataFetchService,
        MetadataFetchPipeline,
      ]),
    );

    const providerFactory = providers.find(
      (p): p is { provide: symbol; useFactory: (...args: unknown[]) => unknown[]; inject: unknown[] } =>
        typeof p === 'object' && p !== null && 'provide' in p && (p as { provide?: unknown }).provide === METADATA_PROVIDERS,
    );

    expect(providerFactory).toBeDefined();
    expect(providerFactory?.inject).toEqual([GoogleProvider, GoodreadsProvider, AmazonProvider, OpenLibraryProvider]);

    const google = { key: 'google' };
    const amazon = { key: 'amazon' };
    expect(providerFactory?.useFactory(google, amazon)).toEqual([google, amazon]);
  });

  it('declares expected imports, controllers, and exports for metadata fetch APIs', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, MetadataFetchModule) as unknown[];
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, MetadataFetchModule) as unknown[];
    const exportsList = Reflect.getMetadata(MODULE_METADATA.EXPORTS, MetadataFetchModule) as unknown[];

    expect(imports).toContain(MetadataPreferencesModule);
    expect(controllers).toContain(MetadataFetchController);
    expect(exportsList).toEqual(expect.arrayContaining([MetadataFetchService, MetadataFetchPipeline, ProviderRegistry]));
  });
});
