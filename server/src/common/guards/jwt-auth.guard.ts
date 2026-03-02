import { ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { FastifyRequest } from 'fastify';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { RequestUser } from '../types/request-user';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  handleRequest<T extends RequestUser>(err: unknown, user: T, _info: unknown, context: ExecutionContext): T {
    if (err || !user) {
      throw (err as Error) || new UnauthorizedException();
    }

    if (user.isDefaultPassword) {
      const req = context.switchToHttp().getRequest<FastifyRequest>();
      const url = req.url.split('?')[0];
      const isChangePassword = url === '/api/v1/auth/change-password' && req.method === 'POST';
      const isMe = url === '/api/v1/auth/me' && req.method === 'GET';
      if (!isChangePassword && !isMe) {
        throw new ForbiddenException('Password change required');
      }
    }

    return user;
  }
}
