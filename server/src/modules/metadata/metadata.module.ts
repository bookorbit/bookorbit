import { Module } from '@nestjs/common';

import { EmbeddingModule } from '../embedding/embedding.module';
import { MetadataScoreModule } from '../metadata-score/metadata-score.module';
import { MetadataService } from './metadata.service';

@Module({
  imports: [EmbeddingModule, MetadataScoreModule],
  providers: [MetadataService],
  exports: [MetadataService],
})
export class MetadataModule {}
