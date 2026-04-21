import { Module } from '@nestjs/common';

import { AuthorsModule } from '../authors/authors.module';
import { FileWriteModule } from '../file-write/file-write.module';
import { LibraryModule } from '../library/library.module';
import { EntityManagerController } from './entity-manager.controller';
import { EntityManagerRepository } from './entity-manager.repository';
import { EntityManagerService } from './entity-manager.service';
import { AuthorStrategy } from './strategies/author.strategy';
import { GenreStrategy } from './strategies/genre.strategy';
import { LanguageStrategy } from './strategies/language.strategy';
import { NarratorStrategy } from './strategies/narrator.strategy';
import { PublisherStrategy } from './strategies/publisher.strategy';
import { SeriesStrategy } from './strategies/series.strategy';
import { TagStrategy } from './strategies/tag.strategy';

@Module({
  imports: [AuthorsModule, FileWriteModule, LibraryModule],
  controllers: [EntityManagerController],
  providers: [
    EntityManagerService,
    EntityManagerRepository,
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
