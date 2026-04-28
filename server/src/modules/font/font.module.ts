import { Module } from '@nestjs/common';

import { FontController } from './font.controller';
import { FontRepository } from './font.repository';
import { FontService } from './font.service';
import { FontStorageService } from './font.storage.service';
import { FontValidationService } from './font.validation.service';

@Module({
  controllers: [FontController],
  providers: [FontService, FontRepository, FontStorageService, FontValidationService],
  exports: [FontService],
})
export class FontModule {}
