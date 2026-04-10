import 'reflect-metadata';

import { MODULE_METADATA } from '@nestjs/common/constants';

import { BookMetadataLockModule } from './book-metadata-lock.module';
import { BookMetadataLockRepository } from './book-metadata-lock.repository';
import { BookMetadataLockService } from './book-metadata-lock.service';

describe('BookMetadataLockModule', () => {
  it('registers and exports metadata lock services', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, BookMetadataLockModule) as Array<unknown>;
    const exports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, BookMetadataLockModule) as Array<unknown>;

    expect(providers).toEqual(expect.arrayContaining([BookMetadataLockRepository, BookMetadataLockService]));
    expect(exports).toEqual([BookMetadataLockService]);
  });
});
