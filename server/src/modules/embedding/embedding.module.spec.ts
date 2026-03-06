import { MODULE_METADATA } from '@nestjs/common/constants';

import { BookEmbedderService } from './book-embedder.service';
import { EmbeddingModule } from './embedding.module';

describe('EmbeddingModule', () => {
  it('registers and exports BookEmbedderService', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, EmbeddingModule);
    const exportsMeta = Reflect.getMetadata(MODULE_METADATA.EXPORTS, EmbeddingModule);

    expect(providers).toEqual(expect.arrayContaining([BookEmbedderService]));
    expect(exportsMeta).toEqual(expect.arrayContaining([BookEmbedderService]));
  });
});
