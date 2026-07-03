import 'reflect-metadata';

vi.mock('../file-write/file-write.module', () => ({ FileWriteModule: class FileWriteModule {} }));
vi.mock('../library/library.module', () => ({ LibraryModule: class LibraryModule {} }));

import { MODULE_METADATA } from '@nestjs/common/constants';

import { BookMoveModule } from './book-move.module';
import { BookMoveRepository } from './book-move.repository';
import { BookMoveService } from './book-move.service';

describe('BookMoveModule', () => {
  it('registers expected provider graph and exports the move service', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, BookMoveModule) as Array<unknown>;
    const exports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, BookMoveModule) as Array<unknown>;

    expect(providers).toEqual(expect.arrayContaining([BookMoveService, BookMoveRepository]));
    expect(exports).toEqual([BookMoveService]);
  });
});
