import { Inject, Injectable } from '@nestjs/common';
import { MetadataCandidate, MetadataProviderKey } from '@projectx/types';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { from, merge, Observable, switchMap } from 'rxjs';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookMetadata } from '../../db/schema';
import { ProviderRegistry } from './provider-registry';
import { isIdentifiable, MetadataProvider } from './providers/metadata-provider';
import { MetadataSearchParams } from './providers/metadata-search-params';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class MetadataFetchService {
  private static readonly PROVIDER_TIMEOUT_MS = 15_000;

  constructor(
    private readonly registry: ProviderRegistry,
    @Inject(DB) private readonly db: Db,
  ) {}

  search(params: MetadataSearchParams, keys?: MetadataProviderKey[]): Observable<MetadataCandidate> {
    const providers = this.registry.select(keys);
    return merge(...providers.map((p) => from(this.withTimeout(this.fetchFromProvider(p, params))).pipe(switchMap((results) => from(results)))));
  }

  async lookupById(key: MetadataProviderKey, providerId: string): Promise<MetadataCandidate | null> {
    const provider = this.registry.find(key);
    if (!provider || !isIdentifiable(provider)) return null;
    return provider.lookupById(providerId);
  }

  async getStoredProviderIds(bookId: number): Promise<Partial<Record<MetadataProviderKey, string>>> {
    const row = await this.db.query.bookMetadata.findFirst({
      where: eq(bookMetadata.bookId, bookId),
      columns: {
        googleBooksId: true,
        goodreadsId: true,
        amazonId: true,
        hardcoverId: true,
        openLibraryId: true,
      },
    });
    if (!row) return {};
    return {
      [MetadataProviderKey.GOOGLE]: row.googleBooksId ?? undefined,
      [MetadataProviderKey.GOODREADS]: row.goodreadsId ?? undefined,
      [MetadataProviderKey.AMAZON]: row.amazonId ?? undefined,
      [MetadataProviderKey.HARDCOVER]: row.hardcoverId ?? undefined,
      [MetadataProviderKey.OPEN_LIBRARY]: row.openLibraryId ?? undefined,
    };
  }

  private fetchFromProvider(p: MetadataProvider, params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    const existingId = params.existingProviderIds?.[p.key];
    if (isIdentifiable(p) && existingId) {
      return p.lookupById(existingId).then((r) => (r ? [r] : []));
    }
    return p.search(params);
  }

  private withTimeout(promise: Promise<MetadataCandidate[]>): Promise<MetadataCandidate[]> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<MetadataCandidate[]>((resolve) => {
      timer = setTimeout(() => resolve([]), MetadataFetchService.PROVIDER_TIMEOUT_MS);
    });
    return Promise.race([promise.catch(() => [] as MetadataCandidate[]), timeout]).finally(() => clearTimeout(timer!));
  }
}
