import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OidcAutoProvision, OidcClaimMapping } from '@bookorbit/types';

import { ensureSafeUrl } from '../../common/utils/ssrf.utils';
import { OidcProviderRepository } from './oidc-provider.repository';

const OIDC_TEST_TIMEOUT_MS = 10_000;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

@Injectable()
export class OidcProviderService {
  private readonly logger = new Logger(OidcProviderService.name);

  constructor(
    private readonly repo: OidcProviderRepository,
    private readonly config: ConfigService,
  ) {}

  findAll() {
    return this.repo.findAll();
  }

  findEnabled() {
    return this.repo.findEnabled();
  }

  async findBySlugOrFail(slug: string) {
    const provider = await this.repo.findBySlug(slug);
    if (!provider) throw new NotFoundException(`OIDC provider '${slug}' not found`);
    return provider;
  }

  async findByIdOrFail(id: number) {
    const provider = await this.repo.findById(id);
    if (!provider) throw new NotFoundException(`OIDC provider #${id} not found`);
    return provider;
  }

  findByIssuerUri(issuerUri: string) {
    return this.repo.findByIssuerUri(issuerUri);
  }

  async create(data: {
    slug: string;
    displayName: string;
    enabled?: boolean;
    issuerUri: string;
    clientId: string;
    clientSecret?: string;
    scopes?: string;
    iconUrl?: string;
    claimMapping?: OidcClaimMapping;
    autoProvision?: OidcAutoProvision;
  }) {
    this.validateSlug(data.slug);

    const existing = await this.repo.findBySlug(data.slug);
    if (existing) throw new ConflictException(`Provider slug '${data.slug}' already exists`);

    return this.repo.create(data);
  }

  async update(
    slug: string,
    data: {
      displayName?: string;
      enabled?: boolean;
      issuerUri?: string;
      clientId?: string;
      clientSecret?: string | null;
      scopes?: string;
      iconUrl?: string | null;
      claimMapping?: OidcClaimMapping;
      autoProvision?: OidcAutoProvision;
    },
  ) {
    const provider = await this.findBySlugOrFail(slug);
    const updated = await this.repo.update(provider.id, data);
    if (!updated) throw new NotFoundException(`OIDC provider '${slug}' not found`);
    return updated;
  }

  async remove(slug: string) {
    const provider = await this.findBySlugOrFail(slug);
    const identityCount = await this.repo.countLinkedIdentities(provider.id);
    if (identityCount > 0) {
      throw new BadRequestException(`Cannot delete provider '${slug}': ${identityCount} user(s) have linked identities. Unlink all users first.`);
    }
    const removed = await this.repo.remove(provider.id);
    if (!removed) throw new NotFoundException(`OIDC provider '${slug}' not found`);
  }

  async reorder(orderedSlugs: string[]) {
    const providers = await this.repo.findAll();
    const slugToId = new Map(providers.map((p) => [p.slug, p.id]));
    const orderedIds: number[] = [];
    for (const slug of orderedSlugs) {
      const id = slugToId.get(slug);
      if (id === undefined) throw new BadRequestException(`Unknown provider slug: '${slug}'`);
      orderedIds.push(id);
    }
    await this.repo.reorder(orderedIds);
  }

  async testConnection(issuerUri: string) {
    if (!issuerUri) throw new BadRequestException('Issuer URI is required');

    const isProduction = this.config.get<string>('app.nodeEnv') === 'production';
    const allowPrivateOidcIssuers = !isProduction || this.config.get<boolean>('app.oidcAllowLocalIssuers') === true;
    const parsed = await ensureSafeUrl(issuerUri, { allowLocal: allowPrivateOidcIssuers, allowPrivate: allowPrivateOidcIssuers });
    const normalized = parsed.href.replace(/\/$/, '');
    const discoveryUrl = `${normalized}/.well-known/openid-configuration`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OIDC_TEST_TIMEOUT_MS);
    const start = Date.now();

    try {
      // codeql[js/request-forgery] - issuerUri is validated by ensureSafeUrl before this point
      const res = await fetch(discoveryUrl, { signal: controller.signal, redirect: 'manual' });
      if (!res.ok) throw new BadRequestException(`Provider returned HTTP ${res.status}`);

      const json: unknown = await res.json();
      if (!isOidcDiscoveryDoc(json)) throw new BadRequestException('Provider returned an invalid discovery document');

      this.logger.log(`[oidc_provider.test_connection] [end] issuerUri=${issuerUri} durationMs=${Date.now() - start} - connection test succeeded`);
      return {
        success: true,
        issuer: json.issuer,
        authorizationEndpoint: json.authorization_endpoint,
        tokenEndpoint: (json as Record<string, unknown>).token_endpoint as string | undefined,
        userinfoEndpoint: (json as Record<string, unknown>).userinfo_endpoint as string | undefined,
        jwksUri: (json as Record<string, unknown>).jwks_uri as string | undefined,
        supportedScopes: (json as Record<string, unknown>).scopes_supported as string[] | undefined,
        supportedGrantTypes: (json as Record<string, unknown>).grant_types_supported as string[] | undefined,
        codeChallengeMethodsSupported: (json as Record<string, unknown>).code_challenge_methods_supported as string[] | undefined,
        backchannelLogoutSupported: (json as Record<string, unknown>).backchannel_logout_supported as boolean | undefined,
      };
    } catch (err) {
      const durationMs = Date.now() - start;
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof BadRequestException) {
        this.logger.warn(
          `[oidc_provider.test_connection] [fail] issuerUri=${issuerUri} durationMs=${durationMs} errorClass=${errorClass} error="${message}" - test rejected`,
        );
        throw err;
      }
      this.logger.warn(
        `[oidc_provider.test_connection] [fail] issuerUri=${issuerUri} durationMs=${durationMs} errorClass=${errorClass} error="${message}" - test failed`,
      );
      throw new BadRequestException(`OIDC connection test failed: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  // Group mapping operations scoped to a provider
  async listGroupMappings(slug: string) {
    const provider = await this.findBySlugOrFail(slug);
    return this.repo.findGroupMappingsByProvider(provider.id);
  }

  async createGroupMapping(slug: string, oidcGroupClaim: string, permissionName: string) {
    const provider = await this.findBySlugOrFail(slug);
    return this.repo.createGroupMapping(provider.id, oidcGroupClaim, permissionName);
  }

  async updateGroupMapping(slug: string, mappingId: number, permissionName: string) {
    const provider = await this.findBySlugOrFail(slug);
    const updated = await this.repo.updateGroupMapping(mappingId, provider.id, permissionName);
    if (!updated) throw new NotFoundException(`Group mapping #${mappingId} not found for provider '${slug}'`);
    return updated;
  }

  async deleteGroupMapping(slug: string, mappingId: number) {
    const provider = await this.findBySlugOrFail(slug);
    const deleted = await this.repo.deleteGroupMapping(mappingId, provider.id);
    if (!deleted) throw new NotFoundException(`Group mapping #${mappingId} not found for provider '${slug}'`);
  }

  private validateSlug(slug: string) {
    if (slug.length < 2 || slug.length > 100) {
      throw new BadRequestException('Slug must be between 2 and 100 characters');
    }
    if (!SLUG_PATTERN.test(slug)) {
      throw new BadRequestException('Slug must be lowercase alphanumeric with hyphens, and must start/end with a letter or number');
    }
  }
}

function isOidcDiscoveryDoc(val: unknown): val is { issuer: string; authorization_endpoint: string } {
  return (
    typeof val === 'object' &&
    val !== null &&
    typeof (val as Record<string, unknown>)['issuer'] === 'string' &&
    typeof (val as Record<string, unknown>)['authorization_endpoint'] === 'string'
  );
}
