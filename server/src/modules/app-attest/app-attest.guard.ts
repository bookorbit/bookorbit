import { CanActivate, ExecutionContext, ForbiddenException, Injectable, type RawBodyRequest, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { apiKeyCredentialOf, type RequestUser } from '../../common/types/request-user';
import { hasInjectedEmptyBody } from '../../common/utils/bootstrap.utils';
import { AppAttestService } from './app-attest.service';

/**
 * Runs after the global JWT guard, so the assertion is always checked against an authenticated user.
 * Covers bodyless requests and JSON bodies; a multipart or streamed body has no raw bytes to hash,
 * so a route that takes one cannot be guarded.
 */
@Injectable()
export class AppAttestGuard implements CanActivate {
  constructor(private readonly appAttest: AppAttestService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RawBodyRequest<FastifyRequest> & { user: RequestUser }>();
    // An API key is never an attested app (C5).
    if (apiKeyCredentialOf(request.user)) {
      throw new ForbiddenException({ message: 'API keys cannot use this route', errorCode: 'API_KEY_ROUTE_FORBIDDEN' });
    }
    this.appAttest.verifyRequest(request.user, {
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: rawBodyOf(request),
    });
    return true;
  }
}

function rawBodyOf(request: RawBodyRequest<FastifyRequest>): Buffer | null {
  if (hasInjectedEmptyBody(request)) return Buffer.alloc(0);
  if (request.rawBody) return request.rawBody;
  const declared = Number(request.headers['content-length'] ?? 0) !== 0 || request.headers['transfer-encoding'] !== undefined;
  return declared ? null : Buffer.alloc(0);
}

export const RequireAppAttest = () => UseGuards(AppAttestGuard);
