import { Module } from '@nestjs/common';

import { EmbeddingModule } from '../embedding/embedding.module';
import { MetadataService } from './metadata.service';

@Module({
  imports: [EmbeddingModule],
  providers: [MetadataService],
  exports: [MetadataService],
})
export class MetadataModule {}
