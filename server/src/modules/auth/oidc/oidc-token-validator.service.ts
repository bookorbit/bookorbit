import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';

type JWKSGetter = ReturnType<typeof createRemoteJWKSet>;

interface JWKSCacheEntry {
  jwks: JWKSGetter;
  fetchedAt: number;
}

@Injectable()
export class OidcTokenValidatorService {
  private readonly logger = new Logger(OidcTokenValidatorService.name);
  private readonly jwksCache = new Map<string, JWKSCacheEntry>();
  private readonly JWKS_TTL = 6 * 3600 * 1000; // 6 hours

  private getJwks(jwksUri: string): JWKSGetter {
    const cached = this.jwksCache.get(jwksUri);
    if (cached && Date.now() - cached.fetchedAt < this.JWKS_TTL) {
      return cached.jwks;
    }
    const jwks = createRemoteJWKSet(new URL(jwksUri));
    this.jwksCache.set(jwksUri, { jwks, fetchedAt: Date.now() });
    return jwks;
  }

  async validateIdToken(idToken: string, opts: { issuer: string; clientId: string; nonce: string; jwksUri: string }) {
    const jwks = this.getJwks(opts.jwksUri);
    try {
      const { payload } = await jwtVerify(idToken, jwks, {
        issuer: opts.issuer,
        audience: opts.clientId,
        clockTolerance: 30,
      });

      if (payload.nonce !== opts.nonce) {
        throw new UnauthorizedException('Invalid nonce');
      }

      return payload;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      this.logger.warn('ID token validation failed', err);
      throw new UnauthorizedException('Invalid ID token');
    }
  }

  async validateLogoutToken(logoutToken: string, opts: { issuer: string; clientId: string; jwksUri: string }) {
    const jwks = this.getJwks(opts.jwksUri);
    try {
      const { payload } = await jwtVerify(logoutToken, jwks, {
        issuer: opts.issuer,
        audience: opts.clientId,
        clockTolerance: 30,
      });

      // Logout tokens must have the backchannel-logout event
      const events = payload['events'] as Record<string, unknown> | undefined;
      if (!events?.['http://schemas.openid.net/event/backchannel-logout']) {
        throw new UnauthorizedException('Not a valid logout token');
      }

      // Logout tokens must not have a nonce
      if (payload.nonce) {
        throw new UnauthorizedException('Logout token must not have nonce');
      }

      return payload;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      this.logger.warn('Logout token validation failed', err);
      throw new UnauthorizedException('Invalid logout token');
    }
  }
}
