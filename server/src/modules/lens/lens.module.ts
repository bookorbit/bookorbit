import { Module } from '@nestjs/common';

import { BookModule } from '../book/book.module';
import { LibraryModule } from '../library/library.module';
import { LensController } from './lens.controller';
import { LensRepository } from './lens.repository';
import { LensService } from './lens.service';

@Module({
  imports: [BookModule, LibraryModule],
  controllers: [LensController],
  providers: [LensService, LensRepository],
})
export class LensModule {}
