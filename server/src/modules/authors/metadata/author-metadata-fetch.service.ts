import { Injectable } from '@nestjs/common';
import { AuthorMetadataCandidate, AuthorMetadataProviderInfo, AuthorMetadataProviderKey } from '@projectx/types';
import { from, merge, Observable, switchMap } from 'rxjs';

import { AuthorMetadataProviderRegistry } from './provider-registry';
import { AuthorMetadataSearchParams, isIdentifiableAuthorProvider } from './providers/author-metadata-provider';

type SearchOptions = {
  keys?: AuthorMetadataProviderKey[];
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
    );
  }

  async quickSearch(params: AuthorMetadataSearchParams, options?: SearchOptions): Promise<AuthorMetadataCandidate | null> {
    const providers = this.registry.select(options?.keys);
    if (providers.length === 0) return null;

    const region = params.region?.trim() || 'us';

    for (const provider of providers) {
      const matches = await this.withTimeout(
        provider.search({
          name: params.name,
          region,
          limit: 1,
        }),
        [],
      );
      const best = matches[0];
      if (!best) continue;

      if (!isIdentifiableAuthorProvider(provider)) {
        return best;
      }

      const detailed = await this.withTimeout(provider.lookupById(best.providerId, region), null);
      return detailed ?? best;
    }

    return null;
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
    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), AuthorMetadataFetchService.PROVIDER_TIMEOUT_MS);
    });
    return Promise.race([promise.catch(() => fallback), timeoutPromise]).finally(() => clearTimeout(timer!));
  }
}
