import { Module } from '@nestjs/common';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { ReadingHelpModule } from '../reading-help/reading-help.module';
import { ServerIdentityModule } from '../server-identity/server-identity.module';
import { StoryGuidesModule } from '../story-guides/story-guides.module';
import { VisionScanModule } from '../vision-scan/vision-scan.module';
import { AppInfoController } from './app-info.controller';
import { AppInfoService } from './app-info.service';

@Module({
  imports: [AppSettingsModule, ServerIdentityModule, StoryGuidesModule, VisionScanModule, ReadingHelpModule],
  controllers: [AppInfoController],
  providers: [AppInfoService],
})
export class AppInfoModule {}
