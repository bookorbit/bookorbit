import { Module } from '@nestjs/common';

import { PermissionService } from './services/permission.service';

@Module({
  providers: [PermissionService],
  exports: [PermissionService],
})
export class CommonModule {}
