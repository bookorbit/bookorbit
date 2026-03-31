import { Module } from '@nestjs/common';

import { BookModule } from '../book/book.module';
import { ReadingSessionController } from './reading-session.controller';
import { ReadingSessionRepository } from './reading-session.repository';
import { ReadingSessionService } from './reading-session.service';

@Module({
  imports: [BookModule],
  controllers: [ReadingSessionController],
  providers: [ReadingSessionService, ReadingSessionRepository],
})
export class ReadingSessionModule {}
