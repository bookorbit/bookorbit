import { SetMetadata } from '@nestjs/common';
import { Permission } from '@bookorbit/types';

export const FORBIDDEN_PERMISSION_KEY = 'forbiddenPermission';

export type ForbiddenPermissionRule = {
  permission: Permission;
  message?: string;
};

export const ForbidPermission = (permission: Permission, message?: string) =>
  SetMetadata(FORBIDDEN_PERMISSION_KEY, { permission, message } satisfies ForbiddenPermissionRule);
