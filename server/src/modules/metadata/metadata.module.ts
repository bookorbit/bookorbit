import { Module } from '@nestjs/common';

import { BookMetadataLockModule } from '../book-metadata-lock/book-metadata-lock.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { MetadataScoreModule } from '../metadata-score/metadata-score.module';
import { NarratorModule } from '../narrator/narrator.module';
import { ComicMetadataRepository } from './comic-metadata.repository';
import { MetadataExtractionService } from './metadata-extraction.service';
import { MetadataEventsService } from './metadata-events.service';
import { MetadataService } from './metadata.service';

@Module({
  imports: [BookMetadataLockModule, EmbeddingModule, MetadataScoreModule, NarratorModule],
  providers: [MetadataService, MetadataExtractionService, MetadataEventsService, ComicMetadataRepository],
  exports: [MetadataService, MetadataExtractionService, MetadataEventsService, ComicMetadataRepository],
})
export class MetadataModule {}
