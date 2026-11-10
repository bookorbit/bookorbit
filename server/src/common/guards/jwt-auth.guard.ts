import { ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { AuthenticationMethod } from '@bookorbit/types';
import type { IncomingHttpHeaders } from 'node:http';

import { AuthenticatorService } from '../../modules/auth/authenticator.service';
import { isApiKeyShaped } from '../../modules/api-key/api-key-token';
import { ALLOW_DEFAULT_PASSWORD_KEY } from '../decorators/allow-default-password.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { RequestUser } from '../types/request-user';

type ApiKeyPresented = { kind: 'none' } | { kind: 'key'; token: string } | { kind: 'conflict' };

const BEARER = /^Bearer\s+(\S+)\s*$/i;

/**
 * An API key may arrive as `X-Api-Key` or as an `Authorization: Bearer` token. Two credentials that
 * disagree are refused rather than one being picked, so a client never runs as someone it did not
 * expect to be (C4).
 */
export function presentedApiKey(headers: IncomingHttpHeaders): ApiKeyPresented {
  const header = headers['x-api-key'];
  if (Array.isArray(header)) return { kind: 'conflict' };
  const fromHeader = header?.trim() || null;

  const authorization = headers.authorization;
  const bearer = typeof authorization === 'string' ? (BEARER.exec(authorization)?.[1] ?? null) : null;
  const bearerKey = bearer && isApiKeyShaped(bearer) ? bearer : null;

  if (fromHeader !== null) {
    if (authorization !== undefined && bearer !== fromHeader) return { kind: 'conflict' };
    return { kind: 'key', token: fromHeader };
  }
  return bearerKey ? { kind: 'key', token: bearerKey } : { kind: 'none' };
}

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly authenticator: AuthenticatorService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Since Nest 12, global guards also run on gateway messages. A socket.io message carries no
    // Authorization header for passport to read; gateways authenticate the socket once, in
    // handleConnection, and their handlers read that user through resolveSocketUser.
    if (context.getType() === 'ws') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{ headers: IncomingHttpHeaders; ip?: string; user?: RequestUser }>();
    const apiKey = presentedApiKey(request.headers);
    if (apiKey.kind === 'conflict') throw new UnauthorizedException('Conflicting credentials');
    if (apiKey.kind === 'key') {
      // Never the default-password gate: a key is not a sign-in and cannot change a password (C3).
      request.user = await this.authenticator.authenticateApiKey(apiKey.token, request.ip ?? null);
      return true;
    }

    return (await super.canActivate(context)) as boolean;
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
