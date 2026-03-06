import 'reflect-metadata';

jest.mock('../embedding/embedding.module', () => ({ EmbeddingModule: class EmbeddingModule {} }));

import { MetadataModule } from './metadata.module';
import { MetadataService } from './metadata.service';

describe('MetadataModule', () => {
  it('registers MetadataService provider/export', () => {
    expect(Reflect.getMetadata('providers', MetadataModule)).toEqual([MetadataService]);
    expect(Reflect.getMetadata('exports', MetadataModule)).toEqual([MetadataService]);
  });
});
