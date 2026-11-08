import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthenticationMethod } from '@bookorbit/types';
import type { Socket } from 'socket.io';

import type { RequestUser } from '../../common/types/request-user';
import { ApiKeyAuthenticator } from '../api-key/api-key.authenticator';
import { isApiKeyShaped } from '../api-key/api-key-token';
import { AuthService } from './auth.service';

export interface AccessTokenPayload {
  sub: number;
  ver: number;
  sid?: number;
  amr?: AuthenticationMethod;
}

/**
 * The one place a raw credential becomes a `RequestUser`. HTTP requests (through `JwtAuthGuard` and
 * `JwtStrategy`) and every socket gateway handshake go through it, so a session or key revoked
 * anywhere is refused everywhere.
 */
@Injectable()
export class AuthenticatorService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
    private readonly apiKeys: ApiKeyAuthenticator,
  ) {}

  authenticateApiKey(token: string, address: string | null): Promise<RequestUser> {
    return this.apiKeys.authenticate(token, address);
  }

  /**
   * Verification failures surface as jsonwebtoken's own errors (`TokenExpiredError` and friends),
   * which `rejectSocketConnection` recognises by name, so a sleeping tab knows to re-authenticate.
   */
  async authenticateAccessToken(token: string): Promise<RequestUser> {
    const payload = this.jwtService.verify<AccessTokenPayload>(token, { algorithms: ['HS256'] });
    return this.authenticatePayload(payload);
  }

  /** A verified access token's claims, checked against the live session and user. */
  async authenticatePayload(payload: AccessTokenPayload): Promise<RequestUser> {
    const user = await this.authService.validateSessionUser(payload.sub, payload.ver, payload.amr ?? 'legacy', payload.sid);
    if (!user) throw new UnauthorizedException('User not found or token revoked');
    return user;
  }

  async authenticateSocket(client: Socket): Promise<RequestUser> {
    const token: unknown = client.handshake.auth?.token;
    if (typeof token !== 'string' || token.length === 0) throw new UnauthorizedException('No token provided');
    if (isApiKeyShaped(token)) return this.authenticateApiKey(token, client.handshake.address || null);
    return this.authenticateAccessToken(token);
  }
}
