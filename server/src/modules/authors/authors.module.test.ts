import 'reflect-metadata';

vi.mock('../app-settings/app-settings.module', () => ({ AppSettingsModule: class AppSettingsModule {} }));
vi.mock('../auth/auth.module', () => ({ AuthModule: class AuthModule {} }));
vi.mock('../book/book.module', () => ({ BookModule: class BookModule {} }));
vi.mock('../library/library.module', () => ({ LibraryModule: class LibraryModule {} }));
vi.mock('../metadata/metadata.module', () => ({ MetadataModule: class MetadataModule {} }));

import { MODULE_METADATA } from '@nestjs/common/constants';

import { AuthorsController } from './authors.controller';
import { AuthorsModule } from './authors.module';
import { AuthorsRepository } from './authors.repository';
import { AuthorsService } from './authors.service';
import { AUTHOR_METADATA_PROVIDERS } from './metadata/constants';

describe('AuthorsModule', () => {
  it('registers expected controller and provider graph', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AuthorsModule);
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AuthorsModule) as Array<unknown>;

    expect(controllers).toEqual([AuthorsController]);
    expect(providers).toEqual(expect.arrayContaining([AuthorsService, AuthorsRepository]));
    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provide: AUTHOR_METADATA_PROVIDERS,
        }),
      ]),
    );
  });
});
