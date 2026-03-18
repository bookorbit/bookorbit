import { Module } from '@nestjs/common';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { AuditCleanupJob } from './audit-cleanup.job';
import { AuditController } from './audit.controller';
import { AuditEventsService } from './audit-events.service';
import { AuditRepository } from './audit.repository';
import { AuditService } from './audit.service';

@Module({
  imports: [AppSettingsModule],
  controllers: [AuditController],
  providers: [AuditEventsService, AuditRepository, AuditService, AuditCleanupJob],
  exports: [AuditEventsService, AuditService],
})
export class AuditModule {}
