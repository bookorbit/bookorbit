import { Module } from '@nestjs/common';

import { CommonModule } from '../../common/common.module';
import { AudiobookChaptersRepository } from './audiobook-chapters.repository';
import { AudiobookChaptersService } from './audiobook-chapters.service';

@Module({
  imports: [CommonModule],
  providers: [AudiobookChaptersRepository, AudiobookChaptersService],
  exports: [AudiobookChaptersService],
})
export class AudiobookChaptersModule {}
