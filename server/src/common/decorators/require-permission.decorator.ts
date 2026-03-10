import { SetMetadata } from '@nestjs/common';
import { Permission } from '@projectx/types';

export const PERMISSION_KEY = 'permission';
export const RequirePermission = (permission: Permission) => SetMetadata(PERMISSION_KEY, permission);
