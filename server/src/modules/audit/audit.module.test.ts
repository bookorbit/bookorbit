import 'reflect-metadata';

import { MODULE_METADATA } from '@nestjs/common/constants';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { AuditCleanupJob } from './audit-cleanup.job';
import { AuditController } from './audit.controller';
import { AuditEventsService } from './audit-events.service';
import { AuditModule } from './audit.module';
import { AuditRepository } from './audit.repository';
import { AuditService } from './audit.service';

describe('AuditModule', () => {
  it('registers expected module metadata', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AuditModule);
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AuditModule);
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AuditModule);
    const exports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, AuditModule);

    expect(imports).toEqual(expect.arrayContaining([AppSettingsModule]));
    expect(controllers).toEqual([AuditController]);
    expect(providers).toEqual(expect.arrayContaining([AuditEventsService, AuditRepository, AuditService, AuditCleanupJob]));
    expect(exports).toEqual(expect.arrayContaining([AuditEventsService, AuditService]));
  });
});
