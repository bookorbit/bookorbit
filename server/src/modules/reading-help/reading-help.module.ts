import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { AppAttestModule } from '../app-attest/app-attest.module';
import { BookModule } from '../book/book.module';
import { ReadingHelpCacheRepository } from './reading-help-cache.repository';
import { ReadingHelpController } from './reading-help.controller';
import { ReadingHelpService } from './reading-help.service';

@Module({
  imports: [AiModule, AppAttestModule, BookModule],
  controllers: [ReadingHelpController],
  providers: [ReadingHelpService, ReadingHelpCacheRepository],
  exports: [ReadingHelpService],
})
export class ReadingHelpModule {}
