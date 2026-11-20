import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { AppAttestModule } from '../app-attest/app-attest.module';
import { VisualMatchModule } from '../visual-match/visual-match.module';
import { VisionScanController } from './vision-scan.controller';
import { VisionScanService } from './vision-scan.service';

@Module({
  imports: [AiModule, AppAttestModule, VisualMatchModule],
  controllers: [VisionScanController],
  providers: [VisionScanService],
  exports: [VisionScanService],
})
export class VisionScanModule {}
