import { Module } from '@nestjs/common';

import { BookEmbedderService } from './book-embedder.service';

@Module({
  providers: [BookEmbedderService],
  exports: [BookEmbedderService],
})
export class EmbeddingModule {}
