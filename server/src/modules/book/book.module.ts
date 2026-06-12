import { Module, forwardRef } from '@nestjs/common';

import { AchievementModule } from '../achievement/achievement.module';
import { AppSettingsModule } from '../app-settings/app-settings.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { FileWriteModule } from '../file-write/file-write.module';
import { LibraryModule } from '../library/library.module';
import { BookMetadataLockModule } from '../book-metadata-lock/book-metadata-lock.module';
import { MetadataModule } from '../metadata/metadata.module';
import { MetadataFetchModule } from '../metadata-fetch/metadata-fetch.module';
import { MetadataScoreModule } from '../metadata-score/metadata-score.module';
import { NarratorModule } from '../narrator/narrator.module';
import { UserBookStatusModule } from '../user-book-status/user-book-status.module';
import { BookReadService } from './book-read.service';
import { BookQueryBuilder } from './book-query-builder.service';
import { BookSortBuilder } from './book-sort-builder.service';
import { BookController } from './book.controller';
import { BookRepository } from './book.repository';
import { BookService } from './book.service';
import { BookAuthorSortKeyBackfillService } from './book-author-sort-key-backfill.service';

@Module({
  imports: [
    forwardRef(() => LibraryModule),
    BookMetadataLockModule,
    MetadataModule,
    EmbeddingModule,
    MetadataFetchModule,
    FileWriteModule,
    AppSettingsModule,
    MetadataScoreModule,
    NarratorModule,
    UserBookStatusModule,
    AchievementModule,
  ],
  controllers: [BookController],
  providers: [BookService, BookRepository, BookReadService, BookSortBuilder, BookQueryBuilder, BookAuthorSortKeyBackfillService],
  exports: [BookService, BookReadService, BookQueryBuilder],
})
export class BookModule {}
