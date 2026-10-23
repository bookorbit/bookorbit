import { ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { ALLOW_DEFAULT_PASSWORD_KEY } from '../decorators/allow-default-password.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { RequestUser } from '../types/request-user';
import { AuthenticationMethod } from '@bookorbit/types';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // Since Nest 12, global guards also run on gateway messages. A socket.io message carries no
    // Authorization header for passport to read; gateways authenticate the socket once, in
    // handleConnection, and their handlers read that user through resolveSocketUser.
    if (context.getType() === 'ws') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  handleRequest<T extends RequestUser>(err: unknown, user: T, _info: unknown, context: ExecutionContext): T {
    if (err || !user) {
      throw new UnauthorizedException();
    }

    if (user.isDefaultPassword && user.authenticationMethod !== AuthenticationMethod.Oidc) {
      const allowDefaultPassword = this.reflector.getAllAndOverride<boolean>(ALLOW_DEFAULT_PASSWORD_KEY, [context.getHandler(), context.getClass()]);
      if (!allowDefaultPassword) {
        throw new ForbiddenException('Password change required');
      }
    }

    return user;
  }
}
