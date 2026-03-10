import { Module } from '@nestjs/common';

import { BookModule } from '../book/book.module';
import { LibraryModule } from '../library/library.module';
import { AuthorImageStorageService } from './author-image-storage.service';
import { AuthorsController } from './authors.controller';
import { AuthorMetadataFetchService } from './metadata/author-metadata-fetch.service';
import { AUTHOR_METADATA_PROVIDERS } from './metadata/constants';
import { AuthorMetadataProviderRegistry } from './metadata/provider-registry';
import { AudnexusAuthorMetadataProvider } from './metadata/providers/audnexus/audnexus.provider';
import { AuthorMetadataProvider } from './metadata/providers/author-metadata-provider';
import { AuthorsRepository } from './authors.repository';
import { AuthorsService } from './authors.service';

const AUTHOR_PROVIDER_CLASSES = [AudnexusAuthorMetadataProvider];

@Module({
  imports: [BookModule, LibraryModule],
  controllers: [AuthorsController],
  providers: [
    ...AUTHOR_PROVIDER_CLASSES,
    {
      provide: AUTHOR_METADATA_PROVIDERS,
      useFactory: (...providers: AuthorMetadataProvider[]) => providers,
      inject: AUTHOR_PROVIDER_CLASSES,
    },
    AuthorMetadataProviderRegistry,
    AuthorMetadataFetchService,
    AuthorImageStorageService,
    AuthorsService,
    AuthorsRepository,
  ],
})
export class AuthorsModule {}
