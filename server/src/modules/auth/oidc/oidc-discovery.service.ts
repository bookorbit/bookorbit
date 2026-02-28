import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';

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
  private readonly TTL = 60 * 60 * 1000; // 1 hour

  async getDiscoveryDoc(issuerUri: string): Promise<OidcDiscoveryDoc> {
    const normalized = issuerUri.replace(/\/$/, '');
    const cached = this.cache.get(normalized);

    if (cached && Date.now() - cached.fetchedAt < this.TTL) {
      return cached.doc;
    }

    const url = `${normalized}/.well-known/openid-configuration`;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = (await res.json()) as RawDiscoveryDoc;

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
      this.logger.error(`Failed to fetch OIDC discovery doc from ${url}`, err);
      throw new InternalServerErrorException('Failed to reach OIDC provider');
    }
  }
}
