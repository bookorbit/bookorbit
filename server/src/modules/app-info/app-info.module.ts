import { Module } from '@nestjs/common';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { ServerIdentityModule } from '../server-identity/server-identity.module';
import { AppInfoController } from './app-info.controller';
import { AppInfoService } from './app-info.service';

@Module({
  imports: [AppSettingsModule, ServerIdentityModule],
  controllers: [AppInfoController],
  providers: [AppInfoService],
})
export class AppInfoModule {}
