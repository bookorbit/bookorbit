import { Module } from '@nestjs/common';

import { AuthorsModule } from '../authors/authors.module';
import { FileWriteModule } from '../file-write/file-write.module';
import { LibraryModule } from '../library/library.module';
import { MetadataScoreModule } from '../metadata-score/metadata-score.module';
import { EntityManagerController } from './entity-manager.controller';
import { EntityManagerRepository } from './entity-manager.repository';
import { EntityManagerService } from './entity-manager.service';
import { DuplicateComputeService } from './duplicate-compute.service';
import { AuthorStrategy } from './strategies/author.strategy';
import { GenreStrategy } from './strategies/genre.strategy';
import { LanguageStrategy } from './strategies/language.strategy';
import { NarratorStrategy } from './strategies/narrator.strategy';
import { PublisherStrategy } from './strategies/publisher.strategy';
import { SeriesStrategy } from './strategies/series.strategy';
import { TagStrategy } from './strategies/tag.strategy';

@Module({
  imports: [AuthorsModule, FileWriteModule, LibraryModule, MetadataScoreModule],
  controllers: [EntityManagerController],
  providers: [
    EntityManagerService,
    EntityManagerRepository,
    DuplicateComputeService,
    AuthorStrategy,
    GenreStrategy,
    TagStrategy,
    NarratorStrategy,
    PublisherStrategy,
    LanguageStrategy,
    SeriesStrategy,
  ],
})
export class EntityManagerModule {}
