import 'reflect-metadata';

vi.mock('../book/book.module', () => ({ BookModule: class BookModule {} }));
vi.mock('../library/library.module', () => ({ LibraryModule: class LibraryModule {} }));

import { MODULE_METADATA } from '@nestjs/common/constants';

import { CollectionController } from './collection.controller';
import { CollectionModule } from './collection.module';
import { CollectionRepository } from './collection.repository';
import { CollectionService } from './collection.service';

describe('CollectionModule', () => {
  it('registers collection controller and providers', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, CollectionModule);
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, CollectionModule) as Array<unknown>;

    expect(controllers).toEqual([CollectionController]);
    expect(providers).toEqual(expect.arrayContaining([CollectionService, CollectionRepository]));
  });
});
