import { Module } from '@nestjs/common';

import { PermissionService } from './services/permission.service';
import { AuthenticationPolicyService } from './services/authentication-policy.service';

@Module({
  providers: [PermissionService, AuthenticationPolicyService],
  exports: [PermissionService, AuthenticationPolicyService],
})
export class CommonModule {}
