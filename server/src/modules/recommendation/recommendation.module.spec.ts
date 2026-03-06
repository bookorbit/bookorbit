import { MODULE_METADATA } from '@nestjs/common/constants';

import { BookModule } from '../book/book.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { LibraryModule } from '../library/library.module';
import { RecommendationController } from './recommendation.controller';
import { RecommendationModule } from './recommendation.module';
import { RecommendationRepository } from './recommendation.repository';
import { RecommendationService } from './recommendation.service';

jest.mock('../book/book.module', () => ({ BookModule: class BookModule {} }));
jest.mock('../library/library.module', () => ({ LibraryModule: class LibraryModule {} }));
jest.mock('../embedding/embedding.module', () => ({ EmbeddingModule: class EmbeddingModule {} }));

describe('RecommendationModule', () => {
  it('registers required imports, controller, and providers', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, RecommendationModule);
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, RecommendationModule);
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, RecommendationModule);

    expect(imports).toEqual(expect.arrayContaining([BookModule, LibraryModule, EmbeddingModule]));
    expect(providers).toEqual(expect.arrayContaining([RecommendationService, RecommendationRepository]));
    expect(controllers).toEqual(expect.arrayContaining([RecommendationController]));
  });
});
