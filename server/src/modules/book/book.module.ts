import { Module, forwardRef } from '@nestjs/common';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { FileWriteModule } from '../file-write/file-write.module';
import { LibraryModule } from '../library/library.module';
import { MetadataModule } from '../metadata/metadata.module';
import { MetadataFetchModule } from '../metadata-fetch/metadata-fetch.module';
import { BookQueryBuilder } from './book-query-builder.service';
import { BookController } from './book.controller';
import { BookRepository } from './book.repository';
import { BookService } from './book.service';

@Module({
  imports: [forwardRef(() => LibraryModule), MetadataModule, EmbeddingModule, MetadataFetchModule, FileWriteModule, AppSettingsModule],
  controllers: [BookController],
  providers: [BookService, BookRepository, BookQueryBuilder],
  exports: [BookService, BookRepository, BookQueryBuilder],
})
export class BookModule {}
