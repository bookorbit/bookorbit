import { Module } from '@nestjs/common';

import { EmbeddingModule } from '../embedding/embedding.module';
import { MetadataScoreModule } from '../metadata-score/metadata-score.module';
import { NarratorModule } from '../narrator/narrator.module';
import { ComicMetadataService } from '../book/comic-metadata.service';
import { MetadataEventsService } from './metadata-events.service';
import { MetadataService } from './metadata.service';

@Module({
  imports: [EmbeddingModule, MetadataScoreModule, NarratorModule],
  providers: [MetadataService, MetadataEventsService, ComicMetadataService],
  exports: [MetadataService, MetadataEventsService],
})
export class MetadataModule {}
