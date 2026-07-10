import { Module } from '@nestjs/common';

import { BookModule } from '../book/book.module';
import { ReadingStateController } from './reading-state.controller';
import { ReadingStateRepository } from './reading-state.repository';
import { ReadingStateService } from './reading-state.service';

@Module({
  imports: [BookModule],
  controllers: [ReadingStateController],
  providers: [ReadingStateService, ReadingStateRepository],
})
export class ReadingStateModule {}
