import { Module } from '@nestjs/common';

import { BookModule } from '../book/book.module';
import { CollectionController } from './collection.controller';
import { CollectionRepository } from './collection.repository';
import { CollectionService } from './collection.service';

@Module({
  imports: [BookModule],
  controllers: [CollectionController],
  providers: [CollectionService, CollectionRepository],
})
export class CollectionModule {}
