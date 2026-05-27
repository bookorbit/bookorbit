import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ensureSafeUrl } from '../../../common/utils/ssrf.utils';

export interface OidcDiscoveryDoc {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  userinfoEndpoint?: string;
  endSessionEndpoint?: string;
  backchannelLogoutSupported: boolean;
}

interface CacheEntry {
  doc: OidcDiscoveryDoc;
  fetchedAt: number;
}

interface RawDiscoveryDoc {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  end_session_endpoint?: string;
  backchannel_logout_supported?: boolean;
}

@Injectable()
export class OidcDiscoveryService {
  private readonly logger = new Logger(OidcDiscoveryService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly TTL: number;
  private readonly allowPrivateOidcIssuers: boolean;

  constructor(private readonly configService: ConfigService) {
    const isProduction = this.configService.get<string>('app.nodeEnv') === 'production';
    this.allowPrivateOidcIssuers = !isProduction || this.configService.get<boolean>('app.oidcAllowLocalIssuers') === true;
    this.TTL = this.configService.get<number>('oidcRuntime.discoveryCacheTtlMs') ?? 60 * 60 * 1000;
  }

  async getDiscoveryDoc(issuerUri: string): Promise<OidcDiscoveryDoc> {
    const normalized = issuerUri.replace(/\/$/, '');
    const cached = this.cache.get(normalized);

    if (cached && Date.now() - cached.fetchedAt < this.TTL) {
      return cached.doc;
    }

    const url = `${normalized}/.well-known/openid-configuration`;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = (await res.json()) as RawDiscoveryDoc;

      // P0-3: Validate issuer matches the URI we requested
      const rawIssuer = (raw.issuer ?? '').replace(/\/$/, '');
      if (rawIssuer !== normalized) {
        throw new Error(`Issuer mismatch: expected "${normalized}", got "${raw.issuer}"`);
      }

      // P0-4: Validate all endpoint URLs are SSRF-safe
      const ssrfOpts = { allowLocal: this.allowPrivateOidcIssuers, allowPrivate: this.allowPrivateOidcIssuers };
      await Promise.all([
        ensureSafeUrl(raw.token_endpoint, ssrfOpts),
        ensureSafeUrl(raw.jwks_uri, ssrfOpts),
        raw.userinfo_endpoint ? ensureSafeUrl(raw.userinfo_endpoint, ssrfOpts) : Promise.resolve(),
        raw.end_session_endpoint ? ensureSafeUrl(raw.end_session_endpoint, ssrfOpts) : Promise.resolve(),
      ]);

      const doc: OidcDiscoveryDoc = {
        issuer: raw.issuer,
        authorizationEndpoint: raw.authorization_endpoint,
        tokenEndpoint: raw.token_endpoint,
        jwksUri: raw.jwks_uri,
        userinfoEndpoint: raw.userinfo_endpoint,
        endSessionEndpoint: raw.end_session_endpoint,
        backchannelLogoutSupported: raw.backchannel_logout_supported === true,
      };

      this.cache.set(normalized, { doc, fetchedAt: Date.now() });
      return doc;
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'UnknownError';
      const errorMessage = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(
        `[auth.oidc_discovery] [fail] issuerUri=${normalized} errorClass=${errorClass} error="${errorMessage}" - discovery fetch failed`,
      );
      throw new InternalServerErrorException('Failed to reach OIDC provider');
    }
  }
}
