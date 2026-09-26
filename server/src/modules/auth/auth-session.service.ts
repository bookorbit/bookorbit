import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import type { AuthClientOptions, AuthenticationMethod, NativeCredentials } from '@bookorbit/types';
import { authConfig } from '../../config/config';
import { AuthSessionRepository, type OidcSessionInput } from './auth-session.repository';
import { hashRefreshToken, nextRefreshToken } from './refresh-token.utils';
import ms, { type StringValue } from 'ms';

@Injectable()
export class AuthSessionService {
  constructor(
    private readonly repository: AuthSessionRepository,
    private readonly jwt: JwtService,
    @Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>,
  ) {}

  expiry(base = new Date()) {
    return new Date(base.getTime() + ms(this.config.jwtRefreshExpiresIn as StringValue));
  }

  async issue(
    userId: number,
    tokenVersion: number,
    authenticationMethod: AuthenticationMethod,
    options: AuthClientOptions = {},
    oidc?: OidcSessionInput,
  ) {
    const refreshToken = randomBytes(32).toString('hex');
    const session = await this.repository.create(
      {
        userId,
        tokenVersion,
        authenticationMethod,
        clientKind: options.clientKind ?? 'web',
        deviceLabel: options.deviceLabel?.trim() || null,
        expiresAt: this.expiry(),
      },
      hashRefreshToken(refreshToken),
      oidc,
    );
    if (!session) throw new UnauthorizedException();
    return this.credentials(session, refreshToken, session.expiresAt);
  }

  async refresh(rawToken: string, userId: number, tokenVersion: number, sessionId: number) {
    const tokens = [rawToken];
    for (let hop = 0; hop < 5; hop++) tokens.push(nextRefreshToken(tokens[hop], this.config.jwtSecret));
    const now = new Date();
    const result = await this.repository.exchange({
      sessionId,
      userId,
      tokenVersion,
      tokenHashes: tokens.map(hashRefreshToken),
      now,
      expiresAt: this.expiry(now),
      graceMs: this.config.refreshRotationGraceMs,
    });
    if (!result) throw new UnauthorizedException();
    return this.credentials(result.session, tokens[result.tokenIndex], result.refresh.expiresAt);
  }

  private credentials(
    session: { id: number; userId: number; tokenVersion: number; authenticationMethod: string },
    refreshToken: string,
    expiresAt: Date,
  ): NativeCredentials {
    const accessToken = this.jwt.sign({ sub: session.userId, ver: session.tokenVersion, amr: session.authenticationMethod, sid: session.id });
    const { exp } = this.jwt.decode<{ exp: number }>(accessToken);
    return {
      accessToken,
      accessTokenExpiresAt: new Date(exp * 1000).toISOString(),
      refreshToken,
      refreshTokenExpiresAt: expiresAt.toISOString(),
      sessionId: session.id,
    };
  }
}
