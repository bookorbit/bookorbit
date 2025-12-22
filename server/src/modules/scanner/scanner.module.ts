import { Module } from '@nestjs/common';

import { MetadataModule } from '../metadata/metadata.module';
import { ScannerController } from './scanner.controller';
import { ScannerRepository } from './scanner.repository';
import { ScannerService } from './scanner.service';

@Module({
  imports: [MetadataModule],
  controllers: [ScannerController],
  providers: [ScannerService, ScannerRepository],
  exports: [ScannerService],
})
export class ScannerModule {}
