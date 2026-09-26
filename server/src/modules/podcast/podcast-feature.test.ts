import { MODULE_METADATA } from '@nestjs/common/constants';
import { APP_FEATURES } from '@bookorbit/types';

import { CollectionService } from '../collection/collection.service';
import { LibraryService } from '../library/library.service';
import { SmartScopeService } from '../smart-scope/smart-scope.service';
import { PodcastCatalogRepository } from './podcast-catalog.repository';
import { PodcastLibraryController } from './podcast.controller';
import { PodcastModule } from './podcast.module';
import { PodcastWorkerService } from './podcast-worker.service';

describe('podcast feature flag', () => {
  it('is hardcoded off and immutable', () => {
    expect(APP_FEATURES.podcasts).toBe(false);
    expect(Object.isFrozen(APP_FEATURES)).toBe(true);
  });

  it('does not register podcast HTTP or runtime providers', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, PodcastModule) as unknown[];
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, PodcastModule) as unknown[];

    expect(controllers).not.toContain(PodcastLibraryController);
    expect(providers).not.toContain(PodcastWorkerService);
    expect(providers).toContain(PodcastCatalogRepository);
  });

  it('rejects podcast records through generic create surfaces', async () => {
    const libraryService = Object.create(LibraryService.prototype) as LibraryService;
    const collectionService = Object.create(CollectionService.prototype) as CollectionService;
    const smartScopeService = Object.create(SmartScopeService.prototype) as SmartScopeService;

    await expect(libraryService.create({ type: 'podcasts', name: 'Podcasts', icon: 'Podcast', folders: ['/podcasts'] } as never)).rejects.toThrow(
      'Podcast libraries are not available',
    );
    await expect(collectionService.create({ name: 'Podcasts', icon: 'Podcast', mediaType: 'podcasts' }, {} as never)).rejects.toThrow(
      'Podcast collections are not available',
    );
    await expect(smartScopeService.create({ name: 'Podcasts', icon: 'Podcast', mediaType: 'podcasts' }, {} as never)).rejects.toThrow(
      'Podcast scopes are not available',
    );
  });

  it('rejects the generic podcast membership surface', () => {
    const collectionService = Object.create(CollectionService.prototype) as CollectionService;

    expect(() => collectionService.findAllWithPodcastMembership({} as never, 1)).toThrow('Collection not found');
  });
});
