import { Injectable, Logger } from '@nestjs/common';
import { MetadataCandidate, MetadataProviderKey, type CoverMedium } from '@bookorbit/types';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { markProviderFailed } from '../../../../common/provider-cache/provider-call-context';
import type { ProviderCacheSpec } from '../../../../common/provider-cache/provider-cache-spec';
import { candidateHasNormalizedIsbn, normalizeMetadataIsbn } from '../../isbn-match';
import { IdentifiableProvider } from '../metadata-provider';
import { MetadataSearchParams } from '../metadata-search-params';
import { pickSearchInputs, providerCacheContext } from '../provider-cache';
import { HardcoverClient } from './hardcover.client';
import { mapBookWithEditions, mapSearchDocument } from './hardcover.mapper';
import { HardcoverBookWithEditions, HardcoverSearchDocument } from './hardcover.types';

function editionMedium(params: MetadataSearchParams | undefined): CoverMedium {
  return params?.isAudiobook ? 'audio' : 'ebook';
}

function mapBook(book: HardcoverBookWithEditions, medium: CoverMedium): MetadataCandidate[] {
  try {
    return mapBookWithEditions(book, medium);
  } catch (err) {
    markProviderFailed('hardcover: book did not map');
    throw err;
  }
}

function mapDocument(doc: HardcoverSearchDocument): MetadataCandidate {
  try {
    return mapSearchDocument(doc);
  } catch (err) {
    markProviderFailed('hardcover: search document did not map');
    throw err;
  }
}

@Injectable()
export class HardcoverProvider implements IdentifiableProvider {
  readonly key = MetadataProviderKey.HARDCOVER;
  readonly label = 'Hardcover';
  readonly identifiable = true as const;
  readonly editionFollowsMedium = true;

  private readonly logger = new Logger(HardcoverProvider.name);

  readonly cache: ProviderCacheSpec<MetadataSearchParams> = {
    version: 1,
    trustEmpty: true,
    context: async () => {
      const { enabled, apiKey } = (await this.providerConfig.getConfig()).hardcover;
      return providerCacheContext(enabled && Boolean(apiKey));
    },
    // An ISBN search that finds nothing falls back to title and author, so every field is part of the key.
    describeSearch: (params) => ({
      inputs: {
        ...pickSearchInputs(params, ['title', 'author', 'isbn', 'hardcoverEditionId']),
        isAudiobook: editionMedium(params) === 'audio',
      },
    }),
    describeLookup: (providerId, params) => ({
      inputs: {
        id: providerId,
        isAudiobook: editionMedium(params) === 'audio',
        hardcoverEditionId: params?.hardcoverEditionId,
        isbn: params?.isbn,
      },
    }),
  };

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
        const candidates = books.flatMap((book) => mapBook(book, editionMedium(params)));
        const pinned = params.hardcoverEditionId
          ? candidates.find((candidate) => candidate.hardcoverEditionId === params.hardcoverEditionId)
          : undefined;
        return pinned ? [pinned] : candidates;
      }
    }

    if (!params.title) return [];

    if (params.author) {
      const docs = signal
        ? await this.client.searchBooks(`${params.title} ${params.author}`, apiKey, signal)
        : await this.client.searchBooks(`${params.title} ${params.author}`, apiKey);
      if (docs.length > 0) {
        return docs.map(mapDocument);
      }
      this.logger.debug(`Hardcover: no results for title+author, retrying with title only`);
    }

    const docs = signal ? await this.client.searchBooks(params.title, apiKey, signal) : await this.client.searchBooks(params.title, apiKey);
    return docs.map(mapDocument);
  }

  async lookupById(providerId: string, signal?: AbortSignal, params?: MetadataSearchParams): Promise<MetadataCandidate | null> {
    const { enabled, apiKey } = await this.providerConfig.getConfig().then((c) => c.hardcover);
    if (!enabled || !apiKey) return null;

    const book = signal ? await this.client.lookupBySlug(providerId, apiKey, signal) : await this.client.lookupBySlug(providerId, apiKey);
    if (!book) return null;

    const candidates = mapBook(book, editionMedium(params));

    if (params?.hardcoverEditionId) {
      const pinned = candidates.find((candidate) => candidate.hardcoverEditionId === params.hardcoverEditionId);
      if (pinned) return pinned;
    }

    const requestedIsbn = normalizeMetadataIsbn(params?.isbn);
    if (requestedIsbn) {
      return candidates.find((candidate) => candidateHasNormalizedIsbn(candidate, requestedIsbn)) ?? null;
    }

    return candidates[0] ?? null;
  }
}
