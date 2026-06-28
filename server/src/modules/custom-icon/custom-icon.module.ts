import { Module } from '@nestjs/common';

import { CustomIconController } from './custom-icon.controller';
import { CustomIconRepository } from './custom-icon.repository';
import { CustomIconService } from './custom-icon.service';
import { CustomIconStorageService } from './custom-icon.storage.service';

@Module({
  controllers: [CustomIconController],
  providers: [CustomIconService, CustomIconRepository, CustomIconStorageService],
  exports: [CustomIconService],
})
export class CustomIconModule {}
