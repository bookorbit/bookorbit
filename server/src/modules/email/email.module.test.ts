import { MODULE_METADATA } from '@nestjs/common/constants';

import { EmailAdminLogController } from './email-admin-log.controller';
import { EmailEncryptionService } from './email-encryption.service';
import { EmailFileSelector } from './email-file-selector';
import { EmailModule } from './email.module';
import { EmailPreferencesController } from './email-preferences.controller';
import { EmailPreferencesRepository } from './email-preferences.repository';
import { EmailPreferencesService } from './email-preferences.service';
import { EmailProviderController } from './email-provider.controller';
import { EmailProviderRepository } from './email-provider.repository';
import { EmailProviderResolver } from './email-provider-resolver';
import { EmailProviderService } from './email-provider.service';
import { EmailRecipientController } from './email-recipient.controller';
import { EmailRecipientGroupController } from './email-recipient-group.controller';
import { EmailRecipientGroupRepository } from './email-recipient-group.repository';
import { EmailRecipientGroupService } from './email-recipient-group.service';
import { EmailRecipientRepository } from './email-recipient.repository';
import { EmailRecipientService } from './email-recipient.service';
import { EmailSendController } from './email-send.controller';
import { EmailSendLogController } from './email-send-log.controller';
import { EmailSendLogRepository } from './email-send-log.repository';
import { EmailSendLogService } from './email-send-log.service';
import { EmailSendOrchestrator } from './email-send-orchestrator.service';
import { EmailTemplateContextService } from './email-template-context.service';
import { EmailTemplateController } from './email-template.controller';
import { EmailTemplateRepository } from './email-template.repository';
import { EmailTemplateService } from './email-template.service';
import { EmailTransportService } from './email-transport.service';

describe('EmailModule metadata', () => {
  it('registers all email controllers', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, EmailModule) as unknown[];

    expect(controllers).toEqual(
      expect.arrayContaining([
        EmailProviderController,
        EmailRecipientController,
        EmailRecipientGroupController,
        EmailTemplateController,
        EmailPreferencesController,
        EmailSendController,
        EmailSendLogController,
        EmailAdminLogController,
      ]),
    );
  });

  it('registers required providers and exports runtime integration services', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, EmailModule) as unknown[];
    const exportsList = Reflect.getMetadata(MODULE_METADATA.EXPORTS, EmailModule) as unknown[];

    expect(providers).toEqual(
      expect.arrayContaining([
        EmailEncryptionService,
        EmailTransportService,
        EmailProviderRepository,
        EmailProviderService,
        EmailRecipientRepository,
        EmailRecipientService,
        EmailRecipientGroupRepository,
        EmailRecipientGroupService,
        EmailTemplateRepository,
        EmailTemplateContextService,
        EmailTemplateService,
        EmailPreferencesRepository,
        EmailPreferencesService,
        EmailProviderResolver,
        EmailFileSelector,
        EmailSendLogRepository,
        EmailSendLogService,
        EmailSendOrchestrator,
      ]),
    );

    expect(exportsList).toEqual(expect.arrayContaining([EmailSendOrchestrator, EmailTransportService, EmailEncryptionService]));
  });
});
