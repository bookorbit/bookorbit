import { Module } from '@nestjs/common';
import { SetupOverviewModule } from '../setup-overview/setup-overview.module';
import { AiSetupFlow } from './ai.setup-flow';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { AuditModule } from '../audit/audit.module';
import { AiAdminController } from './ai-admin.controller';
import { AiAdminService } from './ai-admin.service';
import { AiBudgetRepository } from './ai-budget.repository';
import { AiBudgetService } from './ai-budget.service';
import { AiClient } from './ai-client.service';
import { AiConnectionTestService } from './ai-connection-test.service';
import { AiConnectionRepository } from './ai-connection.repository';
import { AiConnectionService } from './ai-connection.service';
import { AiEventsService } from './ai-events.service';
import { AiJobsBridge } from './ai-jobs-bridge.service';
import { AiLedgerRepository } from './ai-ledger.repository';
import { AiLimiterService } from './ai-limiter';
import { AiHttpService } from './ai-network';
import { AiSecretsService } from './ai-secrets.service';
import { AiSettingsService } from './ai-settings.service';
import { AiTryService } from './ai-try.service';
import { AiUsageFoldJob } from './ai-usage-fold.job';

@Module({
  imports: [SetupOverviewModule, AppSettingsModule, AuditModule],
  controllers: [AiAdminController],
  providers: [
    AiSetupFlow,
    AiConnectionRepository,
    AiLedgerRepository,
    AiBudgetRepository,
    AiSecretsService,
    AiEventsService,
    AiJobsBridge,
    AiConnectionService,
    AiSettingsService,
    AiBudgetService,
    AiLimiterService,
    AiHttpService,
    AiClient,
    AiConnectionTestService,
    AiTryService,
    AiAdminService,
    AiUsageFoldJob,
  ],
  exports: [
    AiClient,
    AiBudgetService,
    AiSettingsService,
    AiEventsService,
    AiJobsBridge,
    AiConnectionService,
    AiConnectionTestService,
    AiLedgerRepository,
  ],
})
export class AiModule {}
