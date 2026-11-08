import { Module } from '@nestjs/common';

import { AppAttestModule } from '../app-attest/app-attest.module';
import { BookModule } from '../book/book.module';
import { TtsAdminController } from './tts-admin.controller';
import { TtsAdminService } from './tts-admin.service';
import { TtsController } from './tts.controller';
import { TtsRepository } from './tts.repository';
import { TtsService } from './tts.service';
import { TtsSynthesisService } from './tts-synthesis.service';
import { TtsTextExtractorService } from './tts-text-extractor.service';
import { TtsProviderFactory } from './providers/tts-provider.factory';

@Module({
  imports: [AppAttestModule, BookModule],
  controllers: [TtsController, TtsAdminController],
  providers: [TtsRepository, TtsService, TtsAdminService, TtsSynthesisService, TtsTextExtractorService, TtsProviderFactory],
})
export class TtsModule {}
