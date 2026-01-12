import { Module } from '@nestjs/common';

import { MailerService } from './services/mailer.service';
import { PermissionService } from './services/permission.service';

@Module({
  providers: [PermissionService, MailerService],
  exports: [PermissionService, MailerService],
})
export class CommonModule {}
