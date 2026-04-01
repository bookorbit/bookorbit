import { Module } from '@nestjs/common';

import { BookEmbeddingVectorizerService } from './book-embedding-vectorizer.service';
import { BookEmbedderRepository } from './book-embedder.repository';
import { BookEmbedderService } from './book-embedder.service';

@Module({
  providers: [BookEmbedderService, BookEmbedderRepository, BookEmbeddingVectorizerService],
  exports: [BookEmbedderService],
})
export class EmbeddingModule {}
