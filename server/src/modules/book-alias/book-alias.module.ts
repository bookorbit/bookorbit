import { Module } from '@nestjs/common';

import { BookAliasRepository } from './book-alias.repository';
import { BookAliasService } from './book-alias.service';

@Module({
  providers: [BookAliasService, BookAliasRepository],
  exports: [BookAliasService],
})
export class BookAliasModule {}
