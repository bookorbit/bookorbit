import 'reflect-metadata';

import { COVER_PROVIDERS } from './constants';
import { CoverController } from './cover.controller';
import { CoverModule } from './cover.module';
import { CoverService } from './cover.service';
import { CoverProviderRegistry } from './provider-registry';
import { AudiobookCoversCoverProvider } from './providers/audiobookcovers-cover-provider';
import { DuckDuckGoCoverProvider } from './providers/duckduckgo-cover-provider';
import { ITunesCoverProvider } from './providers/itunes-cover-provider';

describe('CoverModule', () => {
  it('registers expected controllers/providers/exports and cover provider factory', () => {
    const controllers = Reflect.getMetadata('controllers', CoverModule) as unknown[];
    const providers = Reflect.getMetadata('providers', CoverModule) as unknown[];
    const exportsList = Reflect.getMetadata('exports', CoverModule) as unknown[];

    expect(controllers).toEqual([CoverController]);
    expect(providers).toEqual(
      expect.arrayContaining([DuckDuckGoCoverProvider, ITunesCoverProvider, AudiobookCoversCoverProvider, CoverProviderRegistry, CoverService]),
    );
    expect(exportsList).toEqual([CoverService]);

    const providerFactory = providers.find((value): value is { provide: symbol; inject: unknown[]; useFactory: (...args: unknown[]) => unknown[] } =>
      Boolean(value && typeof value === 'object' && 'provide' in value && (value as { provide?: unknown }).provide === COVER_PROVIDERS),
    );

    expect(providerFactory).toBeDefined();
    expect(providerFactory?.inject).toEqual([DuckDuckGoCoverProvider, ITunesCoverProvider, AudiobookCoversCoverProvider]);

    const duck = { key: 'duckduckgo' };
    const itunes = { key: 'itunes' };
    const audiobookcovers = { key: 'audiobookcovers' };
    expect(providerFactory?.useFactory(duck, itunes, audiobookcovers)).toEqual([duck, itunes, audiobookcovers]);
  });
});
