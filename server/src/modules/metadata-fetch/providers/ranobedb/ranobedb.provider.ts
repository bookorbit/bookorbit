import { Injectable, Logger } from '@nestjs/common';
import { MetadataCandidate, MetadataProviderKey } from '@bookorbit/types';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { markProviderFailed } from '../../../../common/provider-cache/provider-call-context';
import type { ProviderCacheSpec } from '../../../../common/provider-cache/provider-cache-spec';
import { IdentifiableProvider } from '../metadata-provider';
import { MetadataSearchParams } from '../metadata-search-params';
import { pickSearchInputs, providerCacheContext } from '../provider-cache';
import { rethrowWithPartialCandidates } from '../provider-utils';
import { RanobeDbClient } from './ranobedb.client';
import { mapRanobeDbBook } from './ranobedb.mapper';
import { RanobeDbBook } from './ranobedb.types';

@Injectable()
export class RanobeDbProvider implements IdentifiableProvider {
  readonly key = MetadataProviderKey.RANOBEDB;
  readonly label = 'RanobeDB';
  readonly identifiable = true as const;
  readonly coverShape = 'portrait' as const;

  private readonly logger = new Logger(RanobeDbProvider.name);

  readonly cache: ProviderCacheSpec<MetadataSearchParams> = {
    version: 1,
    trustEmpty: true,
    // The book endpoint answers an unknown id with 404.
    authoritativeLookupStatuses: [404],
    context: async () => providerCacheContext((await this.providerConfig.getConfig()).ranobedb.enabled),
    describeSearch: (params) => ({ inputs: pickSearchInputs(params, ['title', 'author']) }),
    describeLookup: (providerId) => ({ inputs: { id: providerId } }),
  };

  constructor(
    private readonly client: RanobeDbClient,
    private readonly providerConfig: ProviderConfigService,
  ) {}

  async search(params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    const { enabled } = await this.providerConfig.getConfig().then((c) => c.ranobedb);
    if (!enabled) return [];

    if (!params.title && !params.author) return [];

    const query = params.author ? `${params.title ?? ''} ${params.author}`.trim() : (params.title ?? '');

    const ids = await this.client.search(query, params.signal);
    if (ids.length === 0) return [];

    const candidates: MetadataCandidate[] = [];
    try {
      for (const id of ids) {
        const response = await this.client.fetchBook(id, params.signal);
        if (!response) continue;
        const candidate = this.mapBook(response.book);
        if (candidate) candidates.push(candidate);
      }
    } catch (err) {
      rethrowWithPartialCandidates(err, candidates);
    }
    return candidates;
  }

  async lookupById(providerId: string, signal?: AbortSignal): Promise<MetadataCandidate | null> {
    const { enabled } = await this.providerConfig.getConfig().then((c) => c.ranobedb);
    if (!enabled) return null;

    if (!/^\d+$/.test(providerId) || !Number.isSafeInteger(Number(providerId))) {
      this.logger.warn(`[ranobedb.lookup] invalid providerId="${providerId}"`);
      return null;
    }

    const response = await this.client.fetchBook(Number(providerId), signal);
    if (!response) return null;

    return this.mapBook(response.book);
  }

  private mapBook(book: RanobeDbBook): MetadataCandidate | null {
    let candidate: MetadataCandidate | null;
    try {
      candidate = mapRanobeDbBook(book);
    } catch (err) {
      markProviderFailed('ranobedb: book did not map');
      throw err;
    }
    if (!candidate) markProviderFailed('ranobedb: book response without id');
    return candidate;
  }
}
