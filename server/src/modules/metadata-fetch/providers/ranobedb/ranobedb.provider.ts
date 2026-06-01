import { Injectable, Logger } from '@nestjs/common';
import { MetadataCandidate, MetadataProviderKey } from '@bookorbit/types';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { IdentifiableProvider } from '../metadata-provider';
import { MetadataSearchParams } from '../metadata-search-params';
import { RanobeDbClient } from './ranobedb.client';
import { mapRanobeDbBook } from './ranobedb.mapper';

@Injectable()
export class RanobeDbProvider implements IdentifiableProvider {
  readonly key = MetadataProviderKey.RANOBEDB;
  readonly label = 'RanobeDB';
  readonly identifiable = true as const;

  private readonly logger = new Logger(RanobeDbProvider.name);

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
    for (const id of ids) {
      const response = await this.client.fetchBook(id, params.signal);
      if (!response) continue;
      const candidate = mapRanobeDbBook(response.book);
      if (candidate) candidates.push(candidate);
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

    return mapRanobeDbBook(response.book);
  }
}
