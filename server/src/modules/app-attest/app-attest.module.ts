import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { appConfig } from '../../config/config';
import { AndroidKeyAttestService } from './android-key-attest.service';
import { AppAttestController } from './app-attest.controller';
import { AppAttestGuard } from './app-attest.guard';
import { ANDROID_KEY_ATTEST_POLICY, androidKeyAttestPolicy, APP_ATTEST_POLICY, appAttestPolicy } from './app-attest.policy';
import { AppAttestService } from './app-attest.service';
import { AppAttestStore } from './app-attest.store';
import { AttestationRevocations } from './attestation-revocations';

@Module({
  controllers: [AppAttestController],
  providers: [
    AppAttestService,
    AppAttestStore,
    AppAttestGuard,
    AndroidKeyAttestService,
    AttestationRevocations,
    { provide: APP_ATTEST_POLICY, inject: [appConfig.KEY], useFactory: (app: ConfigType<typeof appConfig>) => appAttestPolicy(app.nodeEnv) },
    {
      provide: ANDROID_KEY_ATTEST_POLICY,
      inject: [appConfig.KEY],
      useFactory: (app: ConfigType<typeof appConfig>) => androidKeyAttestPolicy(app.nodeEnv),
    },
  ],
  exports: [AppAttestService, AppAttestGuard],
})
export class AppAttestModule {}
