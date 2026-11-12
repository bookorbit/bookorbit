import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  type RawBodyRequest,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { apiKeyCredentialOf, type RequestUser } from '../../common/types/request-user';
import { hasInjectedEmptyBody } from '../../common/utils/bootstrap.utils';
import { APP_ATTEST_HEADERS, AppAttestService } from './app-attest.service';

export const APP_ATTEST_UNSIGNED_KEY = 'appAttest:unsignedOutsideProduction';

/**
 * Runs after the global JWT guard, so the assertion is always checked against an authenticated user.
 * Covers bodyless requests and JSON bodies; a multipart or streamed body has no raw bytes to hash,
 * so a route that takes one cannot be guarded.
 */
@Injectable()
export class AppAttestGuard implements CanActivate {
  constructor(
    private readonly appAttest: AppAttestService,
    private readonly reflector: Reflector = new Reflector(),
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RawBodyRequest<FastifyRequest> & { user: RequestUser }>();
    // An API key is never an attested app (C5).
    if (apiKeyCredentialOf(request.user)) {
      throw new ForbiddenException({ message: 'API keys cannot use this route', errorCode: 'API_KEY_ROUTE_FORBIDDEN' });
    }
    if (this.acceptsUnsigned(context) && !carriesAssertion(request.headers)) return true;
    this.appAttest.verifyRequest(request.user, {
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: rawBodyOf(request),
    });
    return true;
  }

  private acceptsUnsigned(context: ExecutionContext): boolean {
    const marked = this.reflector.getAllAndOverride<boolean | undefined>(APP_ATTEST_UNSIGNED_KEY, [context.getHandler(), context.getClass()]);
    return marked === true && this.appAttest.acceptsUnsigned();
  }
}

/** Any of the assertion headers: a request that sends one is verified, wherever it runs. */
function carriesAssertion(headers: FastifyRequest['headers']): boolean {
  return Object.values(APP_ATTEST_HEADERS).some((name) => headers[name] !== undefined);
}

function rawBodyOf(request: RawBodyRequest<FastifyRequest>): Buffer | null {
  if (hasInjectedEmptyBody(request)) return Buffer.alloc(0);
  if (request.rawBody) return request.rawBody;
  const declared = Number(request.headers['content-length'] ?? 0) !== 0 || request.headers['transfer-encoding'] !== undefined;
  return declared ? null : Buffer.alloc(0);
}

export interface RequireAppAttestOptions {
  /**
   * Outside production, also accept a request with no assertion headers. A request that carries any
   * of them is verified as usual.
   */
  unsignedOutsideProduction?: boolean;
}

export const RequireAppAttest = (options: RequireAppAttestOptions = {}) =>
  options.unsignedOutsideProduction
    ? applyDecorators(SetMetadata(APP_ATTEST_UNSIGNED_KEY, true), UseGuards(AppAttestGuard))
    : UseGuards(AppAttestGuard);
