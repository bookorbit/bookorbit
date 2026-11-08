import { Module } from '@nestjs/common';

import { FileLockService } from './services/file-lock.service';
import { LibraryOperationGate } from './services/library-operation-gate.service';
import { PermissionService } from './services/permission.service';
import { AuthenticationPolicyService } from './services/authentication-policy.service';

@Module({
  providers: [PermissionService, AuthenticationPolicyService, FileLockService, LibraryOperationGate],
  exports: [PermissionService, AuthenticationPolicyService, FileLockService, LibraryOperationGate],
})
export class CommonModule {}
