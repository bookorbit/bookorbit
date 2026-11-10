import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ALLOW_API_KEY_KEY, INTERACTIVE_ONLY_KEY, KEY_READ_SAFE_KEY } from '../decorators/api-key-policy.decorator';
import { apiKeyCredentialOf, type RequestUser } from '../types/request-user';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * What an API key may call, on top of what its narrowed permissions allow. A no-op for sessions.
 * Read-only is decided by HTTP method, so a new route is safe for read-only keys without any
 * annotation; only a read that is a POST needs `@KeyReadSafe()`.
 */
@Injectable()
export class ApiKeyPolicyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<{ user?: RequestUser; method: string }>();
    const credential = apiKeyCredentialOf(request.user);
    if (!credential) return true;

    if (credential.audience !== 'api') throw new UnauthorizedException('Invalid API key');

    const targets = [context.getHandler(), context.getClass()];
    const allowed = this.reflector.get<boolean | undefined>(ALLOW_API_KEY_KEY, context.getHandler());
    if (!allowed && this.reflector.getAllAndOverride<boolean | undefined>(INTERACTIVE_ONLY_KEY, targets)) {
      throw new ForbiddenException({ message: 'API keys cannot use this route', errorCode: 'API_KEY_ROUTE_FORBIDDEN' });
    }

    if (credential.access === 'read' && !READ_METHODS.has(request.method.toUpperCase())) {
      if (!this.reflector.getAllAndOverride<boolean | undefined>(KEY_READ_SAFE_KEY, targets)) {
        throw new ForbiddenException({ message: 'This API key is read-only', errorCode: 'API_KEY_READ_ONLY' });
      }
    }
    return true;
  }
}
