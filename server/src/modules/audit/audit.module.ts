import { Module } from '@nestjs/common';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { AuditCleanupJob } from './audit-cleanup.job';
import { AuditController } from './audit.controller';
import { AuditEventsService } from './audit-events.service';
import { AuditRepository } from './audit.repository';
import { AuditService } from './audit.service';
import { AuditTargetLabelService } from './audit-target-label.service';
import { AuditLabelBackfillService } from './audit-label-backfill.service';

@Module({
  imports: [AppSettingsModule],
  controllers: [AuditController],
  providers: [AuditEventsService, AuditRepository, AuditService, AuditTargetLabelService, AuditLabelBackfillService, AuditCleanupJob],
  exports: [AuditEventsService, AuditService, AuditTargetLabelService],
})
export class AuditModule {}
