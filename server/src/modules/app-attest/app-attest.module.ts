import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { appConfig } from '../../config/config';
import { AppAttestController } from './app-attest.controller';
import { AppAttestGuard } from './app-attest.guard';
import { APP_ATTEST_POLICY, appAttestPolicy } from './app-attest.policy';
import { AppAttestService } from './app-attest.service';
import { AppAttestStore } from './app-attest.store';

@Module({
  controllers: [AppAttestController],
  providers: [
    AppAttestService,
    AppAttestStore,
    AppAttestGuard,
    { provide: APP_ATTEST_POLICY, inject: [appConfig.KEY], useFactory: (app: ConfigType<typeof appConfig>) => appAttestPolicy(app.nodeEnv) },
  ],
  exports: [AppAttestService, AppAttestGuard],
})
export class AppAttestModule {}
