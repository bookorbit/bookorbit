import 'reflect-metadata';

vi.mock('../annotation/annotation.module', () => ({ AnnotationModule: class AnnotationModule {} }));
vi.mock('../authors/authors.module', () => ({ AuthorsModule: class AuthorsModule {} }));
vi.mock('../series/series.module', () => ({ SeriesModule: class SeriesModule {} }));

import { MODULE_METADATA } from '@nestjs/common/constants';

import { BrowseCountsController } from './browse-counts.controller';
import { BrowseCountsModule } from './browse-counts.module';
import { BrowseCountsService } from './browse-counts.service';

describe('BrowseCountsModule', () => {
  it('registers expected controller and provider graph', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, BrowseCountsModule);
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, BrowseCountsModule) as Array<unknown>;

    expect(controllers).toEqual([BrowseCountsController]);
    expect(providers).toEqual([BrowseCountsService]);
  });
});
