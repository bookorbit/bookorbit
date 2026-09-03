import { Module } from '@nestjs/common';

import { LibraryModule } from '../library/library.module';

import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
  imports: [LibraryModule],
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
