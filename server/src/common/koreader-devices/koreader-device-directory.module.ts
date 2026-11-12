import { Module } from '@nestjs/common';

import { KoreaderDeviceDirectoryRepository } from './koreader-device-directory.repository';
import { KoreaderDeviceDirectoryService } from './koreader-device-directory.service';

@Module({
  providers: [KoreaderDeviceDirectoryRepository, KoreaderDeviceDirectoryService],
  exports: [KoreaderDeviceDirectoryService],
})
export class KoreaderDeviceDirectoryModule {}
