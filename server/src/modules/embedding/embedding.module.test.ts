import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { DB } from '../../db';
import { BookEmbeddingVectorizerService } from './book-embedding-vectorizer.service';
import { BookEmbedderRepository } from './book-embedder.repository';
import { BookEmbedderService } from './book-embedder.service';
import { EmbeddingModule } from './embedding.module';

@Global()
@Module({
  providers: [{ provide: DB, useValue: {} }],
  exports: [DB],
})
class DbTestModule {}

describe('EmbeddingModule', () => {
  it('wires embedding providers in a Nest module', async () => {
    const testingModule = await Test.createTestingModule({
      imports: [DbTestModule, EmbeddingModule],
    }).compile();

    expect(testingModule.get(BookEmbedderService)).toBeInstanceOf(BookEmbedderService);
    expect(testingModule.get(BookEmbedderRepository)).toBeInstanceOf(BookEmbedderRepository);
    expect(testingModule.get(BookEmbeddingVectorizerService)).toBeInstanceOf(BookEmbeddingVectorizerService);

    await testingModule.close();
  });
});
