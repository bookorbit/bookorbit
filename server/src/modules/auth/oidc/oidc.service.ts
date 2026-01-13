import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { AppSettingsService } from '../../app-settings/app-settings.service';
import { UserService } from '../../user/user.service';
import { AuthService } from '../auth.service';
import { BackchannelLogoutService } from './backchannel-logout.service';
import { OidcClaimExtractorService } from './oidc-claim-extractor.service';
import { OidcDiscoveryService } from './oidc-discovery.service';
import { OidcGroupMappingService } from './oidc-group-mapping.service';
import { OidcSessionRepository } from './oidc-session.repository';
import { OidcStateService } from './oidc-state.service';
import { OidcTokenClientService } from './oidc-token-client.service';
import { OidcTokenValidatorService } from './oidc-token-validator.service';

@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);

  constructor(
    private readonly appSettings: AppSettingsService,
    private readonly discovery: OidcDiscoveryService,
    private readonly tokenClient: OidcTokenClientService,
    private readonly tokenValidator: OidcTokenValidatorService,
    private readonly claimExtractor: OidcClaimExtractorService,
    private readonly stateService: OidcStateService,
    private readonly sessionRepo: OidcSessionRepository,
    private readonly groupMapping: OidcGroupMappingService,
    private readonly backchannelLogout: BackchannelLogoutService,
    private readonly userService: UserService,
    private readonly authService: AuthService,
  ) {}

  generateState(): string {
    return this.stateService.generate();
  }

  handleBackchannelLogout(logoutToken: string): Promise<void> {
    return this.backchannelLogout.handleLogout(logoutToken);
  }

  async handleCallback(params: { code: string; codeVerifier: string; redirectUri: string; nonce: string; state: string }, reply: FastifyReply) {
    if (!this.stateService.validateAndConsume(params.state)) {
      throw new UnauthorizedException('Invalid or expired state');
    }

    const config = await this.appSettings.getOidcConfig();
    if (!config.enabled) throw new UnauthorizedException('OIDC is not enabled');

    const disc = await this.discovery.getDiscoveryDoc(config.issuerUri);

    const tokens = await this.tokenClient.exchangeCode({
      code: params.code,
      codeVerifier: params.codeVerifier,
      redirectUri: params.redirectUri,
      tokenEndpoint: disc.tokenEndpoint,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });

    const idTokenClaims = await this.tokenValidator.validateIdToken(tokens.idToken, {
      issuer: disc.issuer,
      clientId: config.clientId,
      nonce: params.nonce,
      jwksUri: disc.jwksUri,
    });

    let userInfoClaims: Record<string, unknown> = {};
    if (disc.userinfoEndpoint) {
      userInfoClaims = await this.tokenClient.fetchUserInfo(disc.userinfoEndpoint, tokens.accessToken);
    }

    const claims = this.claimExtractor.extract(idTokenClaims as Record<string, unknown>, userInfoClaims, config.claimMapping);

    const user = await this.findOrProvisionUser(claims, config, disc.issuer);

    // Track OIDC session for backchannel logout
    const sid = (idTokenClaims as Record<string, unknown>).sid ? String((idTokenClaims as Record<string, unknown>).sid) : undefined;
    await this.sessionRepo.create({
      userId: user.id,
      oidcSubject: claims.subject,
      oidcIssuer: disc.issuer,
      oidcSessionId: sid,
      idTokenHint: tokens.idToken,
    });

    return this.authService.issueTokensForUser(user.id, reply);
  }

  private async findOrProvisionUser(
    claims: { subject: string; username: string; name: string; email?: string; avatarUrl?: string; groups: string[] },
    config: Awaited<ReturnType<AppSettingsService['getOidcConfig']>>,
    issuer: string,
  ) {
    // 1. Look up by OIDC subject+issuer (primary key for OIDC identity)
    let user = await this.userService.findByOidcSubject(claims.subject, issuer);

    // 2. Fallback: look up by username and link if allowed
    if (!user && config.autoProvision.allowLocalLinking) {
      const byUsername = await this.userService.findByUsername(claims.username);
      if (byUsername) {
        await this.userService.linkOidcIdentity(byUsername.id, claims.subject, issuer, claims.avatarUrl);
        user = await this.userService.findByOidcSubject(claims.subject, issuer);
      }
    }

    // 3. Auto-provision new user
    if (!user && config.autoProvision.enabled) {
      user = await this.userService.createOidcUser({
        username: claims.username,
        name: claims.name,
        email: claims.email,
        oidcSubject: claims.subject,
        oidcIssuer: issuer,
        avatarUrl: claims.avatarUrl,
      });

      if (config.autoProvision.defaultRoleId) {
        await this.userService.assignRoleDirectly(user.id, config.autoProvision.defaultRoleId);
      }
    }

    if (!user) {
      throw new UnauthorizedException('User not found and auto-provisioning is disabled');
    }

    if (!user.active) {
      throw new UnauthorizedException('Account is deactivated');
    }

    // Sync OIDC group-to-role mappings
    if (claims.groups.length > 0) {
      await this.groupMapping.syncUserGroups(user.id, claims.groups);
    }

    return user;
  }
}
