import { Module, forwardRef } from '@nestjs/common';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { FileWriteModule } from '../file-write/file-write.module';
import { LibraryModule } from '../library/library.module';
import { MetadataModule } from '../metadata/metadata.module';
import { MetadataFetchModule } from '../metadata-fetch/metadata-fetch.module';
import { MetadataScoreModule } from '../metadata-score/metadata-score.module';
import { NarratorModule } from '../narrator/narrator.module';
import { UserBookStatusModule } from '../user-book-status/user-book-status.module';
import { BookReadService } from './book-read.service';
import { BookQueryBuilder } from './book-query-builder.service';
import { BookController } from './book.controller';
import { BookRepository } from './book.repository';
import { BookService } from './book.service';

@Module({
  imports: [
    forwardRef(() => LibraryModule),
    MetadataModule,
    EmbeddingModule,
    MetadataFetchModule,
    FileWriteModule,
    AppSettingsModule,
    MetadataScoreModule,
    NarratorModule,
    UserBookStatusModule,
  ],
  controllers: [BookController],
  providers: [BookService, BookRepository, BookReadService, BookQueryBuilder],
  exports: [BookService, BookReadService, BookQueryBuilder],
})
export class BookModule {}
