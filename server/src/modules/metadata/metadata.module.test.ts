import 'reflect-metadata';

vi.mock('../embedding/embedding.module', () => ({ EmbeddingModule: class EmbeddingModule {} }));

import { MetadataModule } from './metadata.module';
import { MetadataEventsService } from './metadata-events.service';
import { MetadataService } from './metadata.service';
import { ComicMetadataService } from '../book/comic-metadata.service';

describe('MetadataModule', () => {
  it('registers MetadataService provider/export', () => {
    expect(Reflect.getMetadata('providers', MetadataModule)).toEqual([MetadataService, MetadataEventsService, ComicMetadataService]);
    expect(Reflect.getMetadata('exports', MetadataModule)).toEqual([MetadataService, MetadataEventsService]);
  });
});
