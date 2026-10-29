import { Module } from '@nestjs/common';

import { AudiobookChaptersModule } from '../audiobook-chapters/audiobook-chapters.module';
import { BookModule } from '../book/book.module';
import { AudiobookController } from './audiobook.controller';
import { AudiobookRepository } from './audiobook.repository';
import { AudiobookService } from './audiobook.service';

@Module({
  imports: [AudiobookChaptersModule, BookModule],
  controllers: [AudiobookController],
  providers: [AudiobookRepository, AudiobookService],
})
export class AudiobookModule {}
