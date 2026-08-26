import { SetMetadata } from '@nestjs/common';
import { Permission } from '@bookorbit/types';

export const ANY_PERMISSION_KEY = 'anyPermission';

/**
 * Any one of these is enough, where `@RequirePermission` demands all of them.
 *
 * On a handler it replaces the controller's class-level requirement instead of adding to it.
 */
export const RequireAnyPermission = (...permissions: [Permission, Permission, ...Permission[]]) => SetMetadata(ANY_PERMISSION_KEY, permissions);
