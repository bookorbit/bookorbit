import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerOptions } from '@nestjs/throttler';

const DEFAULT_THROTTLER_NAME = 'default';
const THROTTLER_METADATA_KEYS = [
  'THROTTLER:LIMIT',
  'THROTTLER:TTL',
  'THROTTLER:BLOCK_DURATION',
  'THROTTLER:TRACKER',
  'THROTTLER:KEY_GENERATOR',
] as const;

@Injectable()
export class SensitiveEndpointThrottlerGuard extends ThrottlerGuard {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.hasThrottleMetadata(context)) return true;
    return super.canActivate(context);
  }

  private hasThrottleMetadata(context: ExecutionContext): boolean {
    const handler = context.getHandler();
    const classRef = context.getClass();

    return this.configuredThrottlers().some((throttler) => {
      const name = throttler.name ?? DEFAULT_THROTTLER_NAME;
      return THROTTLER_METADATA_KEYS.some((key) => this.reflector.getAllAndOverride(`${key}${name}`, [handler, classRef]) !== undefined);
    });
  }

  private configuredThrottlers(): ThrottlerOptions[] {
    if (this.throttlers?.length) return this.throttlers;
    return Array.isArray(this.options) ? this.options : this.options.throttlers;
  }
}
