import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';

export interface TokenResponse {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

@Injectable()
export class OidcTokenClientService {
  private readonly logger = new Logger(OidcTokenClientService.name);

  async exchangeCode(params: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    tokenEndpoint: string;
    clientId: string;
    clientSecret: string;
  }): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      code_verifier: params.codeVerifier,
      redirect_uri: params.redirectUri,
      client_id: params.clientId,
      client_secret: params.clientSecret,
    });

    const res = await fetch(params.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`Token exchange failed: ${res.status} ${text}`);
      throw new InternalServerErrorException('Token exchange with OIDC provider failed');
    }

    const data = await res.json();
    return {
      accessToken: data.access_token,
      idToken: data.id_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  }

  async fetchUserInfo(userinfoEndpoint: string, accessToken: string): Promise<Record<string, unknown>> {
    try {
      const res = await fetch(userinfoEndpoint, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return {};
      return res.json();
    } catch {
      return {};
    }
  }
}
