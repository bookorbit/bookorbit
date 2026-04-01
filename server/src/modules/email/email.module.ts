import { Module, forwardRef } from '@nestjs/common';

import { BookModule } from '../book/book.module';
import { LibraryModule } from '../library/library.module';
import { EmailAdminLogController } from './email-admin-log.controller';
import { EmailBookAccessService } from './email-book-access.service';
import { EmailBookReadRepository } from './email-book-read.repository';
import { EmailEncryptionService } from './email-encryption.service';
import { EmailFileSelector } from './email-file-selector';
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
import { SystemMailService } from './system-mail.service';

@Module({
  imports: [forwardRef(() => BookModule), forwardRef(() => LibraryModule)],
  controllers: [
    EmailProviderController,
    EmailRecipientController,
    EmailRecipientGroupController,
    EmailTemplateController,
    EmailPreferencesController,
    EmailSendController,
    EmailSendLogController,
    EmailAdminLogController,
  ],
  providers: [
    EmailBookReadRepository,
    EmailBookAccessService,
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
    SystemMailService,
  ],
  exports: [EmailSendOrchestrator, EmailTransportService, EmailEncryptionService, SystemMailService],
})
export class EmailModule {}
