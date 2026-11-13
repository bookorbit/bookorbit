import 'reflect-metadata';

vi.mock('../book/book.module', () => ({ BookModule: class BookModule {} }));
vi.mock('../library/library.module', () => ({ LibraryModule: class LibraryModule {} }));

import { MODULE_METADATA } from '@nestjs/common/constants';

import { GenresController, TagsController } from './taxonomy.controller';
import { TaxonomyModule } from './taxonomy.module';
import { TaxonomyRepository } from './taxonomy.repository';
import { TaxonomyService } from './taxonomy.service';

describe('TaxonomyModule', () => {
  it('registers one controller per kind and exports the service', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, TaxonomyModule);
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, TaxonomyModule) as Array<unknown>;
    const exportsList = Reflect.getMetadata(MODULE_METADATA.EXPORTS, TaxonomyModule) as Array<unknown>;

    expect(controllers).toEqual([GenresController, TagsController]);
    expect(providers).toEqual(expect.arrayContaining([TaxonomyService, TaxonomyRepository]));
    expect(exportsList).toEqual([TaxonomyService]);
  });
});
