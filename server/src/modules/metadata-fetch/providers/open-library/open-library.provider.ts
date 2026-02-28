import { Injectable } from '@nestjs/common';
import { MetadataCandidate, MetadataProviderKey } from '@projectx/types';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { IdentifiableProvider } from '../metadata-provider';
import { MetadataSearchParams } from '../metadata-search-params';
import { mapOpenLibraryDoc, mapOpenLibraryWork } from './open-library.mapper';
import { OpenLibrarySearchResponse, OpenLibraryWork } from './open-library.types';

const BASE_URL = 'https://openlibrary.org';
const SEARCH_FIELDS = 'key,title,author_name,first_publish_year,isbn,cover_i,publisher,language,number_of_pages_median,subject';

@Injectable()
export class OpenLibraryProvider implements IdentifiableProvider {
  readonly key = MetadataProviderKey.OPEN_LIBRARY;
  readonly label = 'OpenLibrary';
  readonly identifiable = true as const;

  constructor(private readonly providerConfig: ProviderConfigService) {}

  async search(params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    const { enabled } = await this.providerConfig.getConfig().then((c) => c.openLibrary);
    if (!enabled) return [];
    const query = this.buildSearchParams(params);
    if (!query) return [];

    query.set('limit', '10');
    query.set('fields', SEARCH_FIELDS);

    const res = await fetch(`${BASE_URL}/search.json?${query}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];

    const body = (await res.json()) as OpenLibrarySearchResponse;
    return body.docs.map(mapOpenLibraryDoc);
  }

  async lookupById(providerId: string): Promise<MetadataCandidate | null> {
    const { enabled } = await this.providerConfig.getConfig().then((c) => c.openLibrary);
    if (!enabled) return null;
    const res = await fetch(`${BASE_URL}/works/${providerId}.json`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;

    const work = (await res.json()) as OpenLibraryWork;
    return mapOpenLibraryWork(work);
  }

  private buildSearchParams(params: MetadataSearchParams): URLSearchParams | null {
    if (!params.isbn && !params.title) return null;

    const query = new URLSearchParams();
    if (params.isbn) {
      query.set('isbn', params.isbn);
    } else {
      query.set('title', params.title!);
      if (params.author) query.set('author', params.author);
    }
    return query;
  }
}
