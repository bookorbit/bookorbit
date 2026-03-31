import 'reflect-metadata';

vi.mock('../embedding/embedding.module', () => ({ EmbeddingModule: class EmbeddingModule {} }));

import { MetadataModule } from './metadata.module';
import { MetadataEventsService } from './metadata-events.service';
import { MetadataService } from './metadata.service';
import { ComicMetadataRepository } from './comic-metadata.repository';

describe('MetadataModule', () => {
  it('registers MetadataService provider/export', () => {
    expect(Reflect.getMetadata('providers', MetadataModule)).toEqual([MetadataService, MetadataEventsService, ComicMetadataRepository]);
    expect(Reflect.getMetadata('exports', MetadataModule)).toEqual([MetadataService, MetadataEventsService, ComicMetadataRepository]);
  });
});
