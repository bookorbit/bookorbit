import { Injectable, Logger } from '@nestjs/common';
import { MetadataCandidate, MetadataProviderKey } from '@bookorbit/types';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { IdentifiableProvider } from '../metadata-provider';
import { MetadataSearchParams } from '../metadata-search-params';
import { HardcoverClient } from './hardcover.client';
import { mapBookWithEditions, mapSearchDocument } from './hardcover.mapper';

@Injectable()
export class HardcoverProvider implements IdentifiableProvider {
  readonly key = MetadataProviderKey.HARDCOVER;
  readonly label = 'Hardcover';
  readonly identifiable = true as const;

  private readonly logger = new Logger(HardcoverProvider.name);

  constructor(
    private readonly client: HardcoverClient,
    private readonly providerConfig: ProviderConfigService,
  ) {}

  async search(params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    const { enabled, apiKey } = await this.providerConfig.getConfig().then((c) => c.hardcover);
    if (!enabled || !apiKey) return [];
    const signal = params.signal;

    if (params.isbn) {
      const books = signal ? await this.client.searchByIsbn(params.isbn, apiKey, signal) : await this.client.searchByIsbn(params.isbn, apiKey);
      if (books.length > 0) {
        return books.flatMap(mapBookWithEditions);
      }
    }

    if (!params.title) return [];

    if (params.author) {
      const docs = signal
        ? await this.client.searchBooks(`${params.title} ${params.author}`, apiKey, signal)
        : await this.client.searchBooks(`${params.title} ${params.author}`, apiKey);
      if (docs.length > 0) {
        return docs.map(mapSearchDocument);
      }
      this.logger.debug(`Hardcover: no results for title+author, retrying with title only`);
    }

    const docs = signal ? await this.client.searchBooks(params.title, apiKey, signal) : await this.client.searchBooks(params.title, apiKey);
    return docs.map(mapSearchDocument);
  }

  async lookupById(providerId: string, signal?: AbortSignal): Promise<MetadataCandidate | null> {
    const { enabled, apiKey } = await this.providerConfig.getConfig().then((c) => c.hardcover);
    if (!enabled || !apiKey) return null;

    const book = signal ? await this.client.lookupBySlug(providerId, apiKey, signal) : await this.client.lookupBySlug(providerId, apiKey);
    if (!book) return null;

    return mapBookWithEditions(book)[0] ?? null;
  }
}
