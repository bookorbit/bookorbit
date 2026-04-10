import 'reflect-metadata';

vi.mock('../book/book.module', () => ({ BookModule: class BookModule {} }));

import { MODULE_METADATA } from '@nestjs/common/constants';

import { BookmarkController } from './bookmark.controller';
import { BookmarkModule } from './bookmark.module';
import { BookmarkRepository } from './bookmark.repository';
import { BookmarkService } from './bookmark.service';

describe('BookmarkModule', () => {
  it('registers expected controller and providers', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, BookmarkModule);
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, BookmarkModule) as Array<unknown>;

    expect(controllers).toEqual([BookmarkController]);
    expect(providers).toEqual(expect.arrayContaining([BookmarkService, BookmarkRepository]));
  });
});
