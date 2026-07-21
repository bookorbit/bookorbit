import 'reflect-metadata';

vi.mock('../embedding/embedding.module', () => ({ EmbeddingModule: class EmbeddingModule {} }));

import { MetadataModule } from './metadata.module';
import { MetadataExtractionService } from './metadata-extraction.service';
import { MetadataEventsService } from './metadata-events.service';
import { MetadataService } from './metadata.service';
import { ComicMetadataRepository } from './comic-metadata.repository';

describe('MetadataModule', () => {
  it('registers MetadataService provider/export', () => {
    const providers = Reflect.getMetadata('providers', MetadataModule);
    const exportedProviders = Reflect.getMetadata('exports', MetadataModule);

    expect(providers).toEqual(expect.arrayContaining([MetadataService, MetadataExtractionService, MetadataEventsService, ComicMetadataRepository]));
    expect(exportedProviders).toEqual(
      expect.arrayContaining([MetadataService, MetadataExtractionService, MetadataEventsService, ComicMetadataRepository]),
    );
  });
});
