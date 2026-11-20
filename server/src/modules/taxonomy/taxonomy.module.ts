import { Module } from '@nestjs/common';

import { BookModule } from '../book/book.module';
import { LibraryModule } from '../library/library.module';
import { GenresController, TagsController } from './taxonomy.controller';
import { TaxonomyRepository } from './taxonomy.repository';
import { TaxonomyService } from './taxonomy.service';

@Module({
  imports: [BookModule, LibraryModule],
  controllers: [GenresController, TagsController],
  providers: [TaxonomyService, TaxonomyRepository],
  exports: [TaxonomyService],
})
export class TaxonomyModule {}
