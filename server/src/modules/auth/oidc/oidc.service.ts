import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { compare } from 'bcryptjs';
import type { FastifyReply } from 'fastify';
import { AuditAction, AuditResource, OidcCallbackResponse, OidcErrorCode, Permission } from '@projectx/types';
import type { OidcAutoProvision, OidcClaimMapping } from '@projectx/types';

import { AUDIT_EVENT, AuditEventsService } from '../../audit/audit-events.service';
import { OidcProviderService } from '../../app-settings/oidc-provider.service';
import { OidcIdentityRepository } from '../../user/oidc-identity.repository';
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

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const directCode = (error as { code?: unknown }).code;
  if (directCode === '23505') return true;
  if (!(error instanceof Error)) return false;
  const causeCode = (error.cause as { code?: unknown } | undefined)?.code;
  return causeCode === '23505';
}

function toThrowable(error: unknown, fallbackMessage: string): Error {
  return error instanceof Error ? error : new UnauthorizedException(fallbackMessage);
}

function normalizeRedirectUri(raw: string): string {
  try {
    const u = new URL(raw);
    return u.origin + u.pathname;
  } catch {
    return raw;
  }
}

@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);
  private readonly appUrl: string;

  constructor(
    private readonly providerService: OidcProviderService,
    private readonly discovery: OidcDiscoveryService,
    private readonly tokenClient: OidcTokenClientService,
    private readonly tokenValidator: OidcTokenValidatorService,
    private readonly claimExtractor: OidcClaimExtractorService,
    private readonly stateService: OidcStateService,
    private readonly sessionRepo: OidcSessionRepository,
    private readonly groupMapping: OidcGroupMappingService,
    private readonly backchannelLogout: BackchannelLogoutService,
    private readonly identityRepo: OidcIdentityRepository,
    private readonly userService: UserService,
    private readonly authService: AuthService,
    private readonly auditEvents: AuditEventsService,
    private readonly configService: ConfigService,
  ) {
    this.appUrl = (this.configService.get<string>('app.appUrl') ?? 'http://localhost:5173').replace(/\/$/, '');
  }

  async generateState(providerSlug: string): Promise<{ state: string; authorizationEndpoint: string }> {
    const provider = await this.providerService.findBySlugOrFail(providerSlug);
    if (!provider.enabled) throw new UnauthorizedException('OIDC provider is not enabled');
    const [state, disc] = await Promise.all([this.stateService.generate(provider.id), this.discovery.getDiscoveryDoc(provider.issuerUri)]);
    return { state, authorizationEndpoint: disc.authorizationEndpoint };
  }

  async generateLinkState(
    userId: number,
    providerSlug: string,
  ): Promise<{ state: string; authorizationEndpoint: string; clientId: string; scopes: string }> {
    const provider = await this.providerService.findBySlugOrFail(providerSlug);
    if (!provider.enabled) throw new UnauthorizedException('OIDC provider is not enabled');

    const existing = await this.identityRepo.findByUserAndProvider(userId, provider.id);
    if (existing) throw new BadRequestException('You already have an identity linked to this provider');

    const [state, disc] = await Promise.all([
      this.stateService.generate(provider.id, { mode: 'link', userId }),
      this.discovery.getDiscoveryDoc(provider.issuerUri),
    ]);
    return { state, authorizationEndpoint: disc.authorizationEndpoint, clientId: provider.clientId, scopes: provider.scopes };
  }

  async generatePreviewState(providerSlug: string): Promise<{ state: string; authorizationEndpoint: string }> {
    const provider = await this.providerService.findBySlugOrFail(providerSlug);
    if (!provider.enabled) throw new UnauthorizedException('OIDC provider is not enabled');
    const [state, disc] = await Promise.all([
      this.stateService.generate(provider.id, { mode: 'preview' }),
      this.discovery.getDiscoveryDoc(provider.issuerUri),
    ]);
    return { state, authorizationEndpoint: disc.authorizationEndpoint };
  }

  handleBackchannelLogout(logoutToken: string): Promise<void> {
    return this.backchannelLogout.handleLogout(logoutToken);
  }

  async getLinkedIdentities(userId: number) {
    return this.identityRepo.findByUser(userId);
  }

  async unlinkIdentity(userId: number, providerId: number, password: string): Promise<void> {
    const hash = await this.userService.findPasswordHashById(userId);
    if (!hash) throw new BadRequestException('User not found');

    const valid = await compare(password, hash);
    if (!valid) throw new BadRequestException('Incorrect password');

    const identity = await this.identityRepo.findByUserAndProvider(userId, providerId);
    if (!identity) throw new NotFoundException('No identity linked to this provider');

    // D4: Check if user has local password OR another linked identity
    const user = await this.userService.findById(userId);
    if (!user) throw new BadRequestException('User not found');

    const identityCount = await this.identityRepo.countByUser(userId);
    const hasLocalAuth = user.provisioningMethod !== 'oidc';
    if (!hasLocalAuth && identityCount <= 1) {
      throw new BadRequestException('Cannot unlink: this is your only authentication method. Set a password first.');
    }

    await this.identityRepo.remove(userId, providerId);

    // Clean up provider-scoped permission grants
    await this.groupMapping.removeProviderGrants(userId, providerId);

    this.auditEvents.emit(AUDIT_EVENT, {
      userId,
      actorUsername: 'self',
      action: AuditAction.OidcIdentityUnlinked,
      resource: AuditResource.OidcIdentity,
      resourceId: userId,
      description: `User unlinked OIDC identity (issuer: ${identity.oidcIssuer ?? 'unknown'})`,
    });
  }

  async handleCallback(
    params: { code: string; codeVerifier: string; redirectUri: string; nonce: string; state: string },
    reply: FastifyReply,
  ): Promise<OidcCallbackResponse> {
    const stateResult = await this.stateService.validateAndConsume(params.state);
    if (!stateResult.valid || !stateResult.providerId) {
      throw new UnauthorizedException({
        message: 'Your login session expired. Please try signing in again.',
        errorCode: OidcErrorCode.STATE_EXPIRED,
      });
    }

    const provider = await this.providerService.findByIdOrFail(stateResult.providerId);
    if (!provider.enabled) throw new UnauthorizedException('OIDC provider is not enabled');

    const claimMapping = provider.claimMapping as OidcClaimMapping;
    const autoProvision = provider.autoProvision as OidcAutoProvision;

    const allowedRedirectUri = `${this.appUrl}/oauth2-callback`;
    if (normalizeRedirectUri(params.redirectUri) !== normalizeRedirectUri(allowedRedirectUri)) {
      throw new BadRequestException(`Redirect URI is not allowed: ${params.redirectUri}`);
    }

    const disc = await this.discovery.getDiscoveryDoc(provider.issuerUri);

    let tokens: Awaited<ReturnType<typeof this.tokenClient.exchangeCode>>;
    try {
      tokens = await this.tokenClient.exchangeCode({
        code: params.code,
        codeVerifier: params.codeVerifier,
        redirectUri: params.redirectUri,
        tokenEndpoint: disc.tokenEndpoint,
        clientId: provider.clientId,
        clientSecret: provider.clientSecret ?? '',
      });
    } catch {
      throw new UnauthorizedException({
        message: 'Could not complete sign-in with your provider. Please try again or contact your administrator.',
        errorCode: OidcErrorCode.TOKEN_EXCHANGE_FAILED,
      });
    }

    const idTokenClaims = await this.tokenValidator.validateIdToken(tokens.idToken, {
      issuer: disc.issuer,
      clientId: provider.clientId,
      nonce: params.nonce,
      jwksUri: disc.jwksUri,
    });

    let userInfoClaims: Record<string, unknown> = {};
    if (disc.userinfoEndpoint) {
      userInfoClaims = await this.tokenClient.fetchUserInfo(disc.userinfoEndpoint, tokens.accessToken);
    }

    const claims = this.claimExtractor.extract(idTokenClaims as Record<string, unknown>, userInfoClaims, claimMapping);
    if (!claims.subject) {
      this.logger.warn('[auth.oidc_callback] [fail] errorClass=UnauthorizedException error="missing sub claim" - OIDC callback failed');
      throw new UnauthorizedException({
        message: 'Could not complete sign-in with your provider. Please try again or contact your administrator.',
        errorCode: OidcErrorCode.TOKEN_EXCHANGE_FAILED,
      });
    }

    const mode = (stateResult.meta?.mode as string) ?? 'login';

    if (mode === 'preview') {
      return {
        mode: 'preview',
        claims: {
          raw: { ...(idTokenClaims as Record<string, unknown>), ...userInfoClaims },
          mapped: { username: claims.username, name: claims.name, email: claims.email, groups: claims.groups },
        },
      };
    }

    if (mode === 'link') {
      const targetUserId = stateResult.meta?.userId as number;
      await this.identityRepo.create({
        userId: targetUserId,
        providerId: provider.id,
        oidcSubject: claims.subject,
        oidcIssuer: disc.issuer,
      });

      // Also update avatar if available
      if (claims.avatarUrl) {
        await this.userService.linkOidcIdentity(targetUserId, claims.subject, disc.issuer, claims.avatarUrl);
      }

      this.auditEvents.emit(AUDIT_EVENT, {
        userId: targetUserId,
        actorUsername: 'self',
        action: AuditAction.OidcIdentityLinked,
        resource: AuditResource.OidcIdentity,
        resourceId: targetUserId,
        description: `User linked OIDC identity (issuer: ${disc.issuer}, subject: ${claims.subject})`,
      });

      return { mode: 'link', linked: true };
    }

    // Default: login flow
    const user = await this.findOrProvisionUser(claims, provider, disc.issuer, autoProvision);

    const sid = (idTokenClaims as Record<string, unknown>).sid ? String((idTokenClaims as Record<string, unknown>).sid) : undefined;
    await this.sessionRepo.create({
      userId: user.id,
      providerId: provider.id,
      oidcSubject: claims.subject,
      oidcIssuer: disc.issuer,
      oidcSessionId: sid,
      idTokenHint: tokens.idToken,
      idpRefreshToken: tokens.refreshToken ?? null,
      expiresAt: this.authService.getRefreshTokenExpiryDate(),
    });

    this.auditEvents.emit(AUDIT_EVENT, {
      userId: user.id,
      actorUsername: user.username,
      action: AuditAction.OidcLogin,
      resource: AuditResource.OidcIdentity,
      resourceId: user.id,
      description: `User logged in via OIDC (issuer: ${disc.issuer})`,
    });

    const authResult = await this.authService.issueTokensForUser(user.id, reply);
    return { mode: 'login' as const, ...authResult } as OidcCallbackResponse;
  }

  private async findOrProvisionUser(
    claims: { subject: string; username: string; name: string; email?: string; avatarUrl?: string; groups: string[] },
    provider: Awaited<ReturnType<OidcProviderService['findByIdOrFail']>>,
    issuer: string,
    autoProvision: OidcAutoProvision,
  ) {
    // Look up by identity table first
    const identity = await this.identityRepo.findByProviderAndSubject(provider.id, claims.subject);
    let user = identity ? await this.userService.findById(identity.userId) : null;

    if (!user && autoProvision.allowLocalLinking) {
      // Case-insensitive username matching for auto-link
      const byUsername = await this.userService.findByUsername(claims.username);
      if (byUsername) {
        let linkConflict: unknown;
        try {
          await this.identityRepo.create({
            userId: byUsername.id,
            providerId: provider.id,
            oidcSubject: claims.subject,
            oidcIssuer: issuer,
          });
          // Also maintain legacy columns for backward compatibility
          await this.userService.linkOidcIdentity(byUsername.id, claims.subject, issuer, claims.avatarUrl);

          this.auditEvents.emit(AUDIT_EVENT, {
            userId: byUsername.id,
            actorUsername: byUsername.username,
            action: AuditAction.OidcIdentityLinked,
            resource: AuditResource.OidcIdentity,
            resourceId: byUsername.id,
            description: `OIDC identity auto-linked to existing local account (issuer: ${issuer})`,
          });
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          linkConflict = error;
        }
        const recheckIdentity = await this.identityRepo.findByProviderAndSubject(provider.id, claims.subject);
        user = recheckIdentity ? await this.userService.findById(recheckIdentity.userId) : null;
        if (!user && linkConflict) {
          throw toThrowable(linkConflict, 'OIDC identity conflict');
        }
      }
    }

    let createdUser = false;
    if (!user && autoProvision.enabled) {
      try {
        const rawUser = await this.userService.createOidcUser({
          username: claims.username,
          name: claims.name,
          email: claims.email,
          oidcSubject: claims.subject,
          oidcIssuer: issuer,
          avatarUrl: claims.avatarUrl,
        });
        createdUser = true;

        // Create identity link in new table
        await this.identityRepo.create({
          userId: rawUser.id,
          providerId: provider.id,
          oidcSubject: claims.subject,
          oidcIssuer: issuer,
        });

        user = await this.userService.findById(rawUser.id);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const recheckIdentity = await this.identityRepo.findByProviderAndSubject(provider.id, claims.subject);
        user = recheckIdentity ? await this.userService.findById(recheckIdentity.userId) : null;
        if (!user) {
          throw new UnauthorizedException({
            message: 'Your account has not been set up. Contact your administrator for access.',
            errorCode: OidcErrorCode.USER_NOT_PROVISIONED,
          });
        }
      }

      if (createdUser && autoProvision.defaultPermissionNames?.length) {
        await this.userService.setPermissionsDirectly(user!.id, autoProvision.defaultPermissionNames as Permission[]);
      }

      if (createdUser && user) {
        this.auditEvents.emit(AUDIT_EVENT, {
          userId: user.id,
          actorUsername: user.username,
          action: AuditAction.OidcUserProvisioned,
          resource: AuditResource.OidcIdentity,
          resourceId: user.id,
          description: `User auto-provisioned via OIDC (issuer: ${issuer}, subject: ${claims.subject})`,
        });
      }
    }

    if (!user) {
      throw new UnauthorizedException({
        message: 'Your account has not been set up. Contact your administrator for access.',
        errorCode: OidcErrorCode.USER_NOT_PROVISIONED,
      });
    }

    if (!user.active) {
      throw new UnauthorizedException({
        message: 'Your account has been deactivated. Contact your administrator.',
        errorCode: OidcErrorCode.USER_INACTIVE,
      });
    }

    await this.groupMapping.syncUserGroups(user.id, provider.id, claims.groups);

    return user;
  }
}
