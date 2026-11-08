import type { TestingModuleBuilder } from '@nestjs/testing';

import { AppAttestGuard } from '../../src/modules/app-attest/app-attest.guard';

/**
 * Genuine App Attest needs an iPhone, so an e2e app lets the guarded routes through and tests what
 * those routes do. `app-attest-enforcement` runs the real guard against every guarded route.
 */
export function allowAppAttest(builder: TestingModuleBuilder): TestingModuleBuilder {
  return builder.overrideGuard(AppAttestGuard).useValue({ canActivate: () => true });
}
