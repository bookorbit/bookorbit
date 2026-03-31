import { Injectable } from '@nestjs/common';
import { AuthorMetadataCandidate, AuthorMetadataProviderInfo, AuthorMetadataProviderKey } from '@projectx/types';
import { from, merge, Observable, switchMap, take } from 'rxjs';

import { AuthorMetadataProviderRegistry } from './provider-registry';
import { AuthorMetadataProviderError, AuthorMetadataSearchParams, isIdentifiableAuthorProvider } from './providers/author-metadata-provider';

type SearchOptions = {
  keys?: AuthorMetadataProviderKey[];
};

export type AuthorMetadataFetchFailure = {
  provider: AuthorMetadataProviderKey;
  message: string;
  httpStatus: number | null;
  retryAfterMs: number | null;
  transient: boolean;
};

export type AuthorQuickSearchResult = {
  candidate: AuthorMetadataCandidate | null;
  failure: AuthorMetadataFetchFailure | null;
};

@Injectable()
export class AuthorMetadataFetchService {
  private static readonly PROVIDER_TIMEOUT_MS = 15_000;

  constructor(private readonly registry: AuthorMetadataProviderRegistry) {}

  listProviders(): AuthorMetadataProviderInfo[] {
    return this.registry.all().map((provider) => ({
      key: provider.key,
      label: provider.label,
      identifiable: provider.identifiable,
    }));
  }

  async search(params: AuthorMetadataSearchParams, options?: SearchOptions): Promise<AuthorMetadataCandidate[]> {
    const providers = this.registry.select(options?.keys);
    if (providers.length === 0) return [];

    const limit = this.normalizeLimit(params.limit);
    const batches = await Promise.all(
      providers.map((provider) =>
        this.withTimeout(
          provider.search({
            ...params,
            limit,
          }),
          [],
        ),
      ),
    );

    return batches.flat().slice(0, limit);
  }

  stream(params: AuthorMetadataSearchParams, options?: SearchOptions): Observable<AuthorMetadataCandidate> {
    const providers = this.registry.select(options?.keys);
    if (providers.length === 0) return from([]);

    const limit = this.normalizeLimit(params.limit);
    return merge(
      ...providers.map((provider) =>
        from(
          this.withTimeout(
            provider.search({
              ...params,
              limit,
            }),
            [],
          ),
        ).pipe(switchMap((candidates) => from(candidates.slice(0, limit)))),
      ),
    ).pipe(take(limit));
  }

  async quickSearchDetailed(params: AuthorMetadataSearchParams, options?: SearchOptions): Promise<AuthorQuickSearchResult> {
    const providers = this.registry.select(options?.keys);
    if (providers.length === 0) return { candidate: null, failure: null };

    const region = params.region?.trim() || 'us';
    let lastFailure: AuthorMetadataFetchFailure | null = null;

    for (const provider of providers) {
      const matchesResult = await this.withTimeoutResult(
        provider.search({
          name: params.name,
          region,
          limit: 1,
        }),
      );
      if (!matchesResult.ok) {
        lastFailure = this.toFailure(provider.key, matchesResult.error);
        continue;
      }

      const matches = matchesResult.value;
      const best = matches[0];
      if (!best) continue;

      if (!isIdentifiableAuthorProvider(provider)) {
        return { candidate: best, failure: null };
      }

      const detailResult = await this.withTimeoutResult(provider.lookupById(best.providerId, region));
      if (!detailResult.ok) {
        return { candidate: best, failure: null };
      }

      return { candidate: detailResult.value ?? best, failure: null };
    }

    return { candidate: null, failure: lastFailure };
  }

  async lookupById(key: AuthorMetadataProviderKey, providerId: string, region?: string): Promise<AuthorMetadataCandidate | null> {
    const provider = this.registry.find(key);
    if (!provider || !isIdentifiableAuthorProvider(provider)) return null;
    return this.withTimeout(provider.lookupById(providerId, region), null);
  }

  private normalizeLimit(limit?: number): number {
    if (!Number.isFinite(limit)) return 10;
    const numeric = Number(limit);
    return Math.max(1, Math.min(25, Math.floor(numeric)));
  }

  private async withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
    const result = await this.withTimeoutResult(promise);
    return result.ok ? result.value : fallback;
  }

  private async withTimeoutResult<T>(promise: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise<{ ok: false; error: unknown }>((resolve) => {
      timer = setTimeout(
        () =>
          resolve({
            ok: false,
            error: new AuthorMetadataProviderError('Author metadata provider timeout', {
              transient: true,
            }),
          }),
        AuthorMetadataFetchService.PROVIDER_TIMEOUT_MS,
      );
    });
    const mainPromise = promise
      .then((value): { ok: true; value: T } => ({ ok: true, value }))
      .catch((error): { ok: false; error: unknown } => ({ ok: false, error }));

    return Promise.race([mainPromise, timeoutPromise]).finally(() => clearTimeout(timer!));
  }

  private toFailure(provider: AuthorMetadataProviderKey, error: unknown): AuthorMetadataFetchFailure {
    if (error instanceof AuthorMetadataProviderError) {
      return {
        provider,
        message: error.message,
        httpStatus: error.httpStatus,
        retryAfterMs: error.retryAfterMs,
        transient: error.transient,
      };
    }

    return {
      provider,
      message: error instanceof Error ? error.message : 'Unknown provider error',
      httpStatus: null,
      retryAfterMs: null,
      transient: true,
    };
  }
}
