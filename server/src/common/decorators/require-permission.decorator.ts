import { SetMetadata } from '@nestjs/common';
import { Permission } from '@bookorbit/types';

export const PERMISSION_KEY = 'permission';
export const RequirePermission = (...permissions: [Permission, ...Permission[]]) =>
  SetMetadata(PERMISSION_KEY, permissions.length === 1 ? permissions[0] : permissions);
