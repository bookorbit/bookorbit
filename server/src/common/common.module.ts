import { Module } from '@nestjs/common';

import { FileLockService } from './services/file-lock.service';
import { PermissionService } from './services/permission.service';
import { AuthenticationPolicyService } from './services/authentication-policy.service';

@Module({
  providers: [PermissionService, AuthenticationPolicyService, FileLockService],
  exports: [PermissionService, AuthenticationPolicyService, FileLockService],
})
export class CommonModule {}
