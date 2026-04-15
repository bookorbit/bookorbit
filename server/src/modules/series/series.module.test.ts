import 'reflect-metadata';

vi.mock('../book/book.module', () => ({ BookModule: class BookModule {} }));
vi.mock('../library/library.module', () => ({ LibraryModule: class LibraryModule {} }));

import { MODULE_METADATA } from '@nestjs/common/constants';

import { SeriesController } from './series.controller';
import { SeriesModule } from './series.module';
import { SeriesRepository } from './series.repository';
import { SeriesService } from './series.service';

describe('SeriesModule', () => {
  it('registers expected controller and provider graph', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, SeriesModule);
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, SeriesModule) as Array<unknown>;

    expect(controllers).toEqual([SeriesController]);
    expect(providers).toEqual(expect.arrayContaining([SeriesService, SeriesRepository]));
  });
});
