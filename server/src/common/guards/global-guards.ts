import { JwtAuthGuard } from './jwt-auth.guard';
import { LibraryAccessGuard } from './library-access.guard';
import { PermissionGuard } from './permission.guard';
import { SensitiveEndpointThrottlerGuard } from './sensitive-endpoint-throttler.guard';

/**
 * Every guard the app installs with APP_GUARD, in the order Nest runs them. Since Nest 12 these also
 * run on gateway messages, so the gateway socket tests install this exact list.
 */
export const GLOBAL_GUARDS = [SensitiveEndpointThrottlerGuard, JwtAuthGuard, PermissionGuard, LibraryAccessGuard] as const;
