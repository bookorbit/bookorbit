import { Module } from '@nestjs/common';

import { FontModule } from '../font/font.module';
import { ServerFontController } from './server-font.controller';
import { ServerFontRepository } from './server-font.repository';
import { ServerFontService } from './server-font.service';
import { ServerFontStorageService } from './server-font.storage.service';

@Module({
  imports: [FontModule],
  controllers: [ServerFontController],
  providers: [ServerFontService, ServerFontRepository, ServerFontStorageService],
  exports: [ServerFontService],
})
export class ServerFontModule {}
