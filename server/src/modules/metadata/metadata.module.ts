import { Module } from '@nestjs/common';

import { EmbeddingModule } from '../embedding/embedding.module';
import { MetadataScoreModule } from '../metadata-score/metadata-score.module';
import { NarratorModule } from '../narrator/narrator.module';
import { ComicMetadataRepository } from './comic-metadata.repository';
import { MetadataEventsService } from './metadata-events.service';
import { MetadataService } from './metadata.service';

@Module({
  imports: [EmbeddingModule, MetadataScoreModule, NarratorModule],
  providers: [MetadataService, MetadataEventsService, ComicMetadataRepository],
  exports: [MetadataService, MetadataEventsService, ComicMetadataRepository],
})
export class MetadataModule {}
