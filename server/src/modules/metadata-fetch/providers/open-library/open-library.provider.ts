import { Injectable, Logger } from '@nestjs/common';
import { MetadataCandidate, MetadataProviderKey } from '@projectx/types';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { fetchWithThrottle } from '../../fetch-with-throttle';
import { ProviderThrottleError } from '../../provider-throttle.error';
import { IdentifiableProvider } from '../metadata-provider';
import { MetadataSearchParams } from '../metadata-search-params';
import { mapOpenLibraryDoc, mapOpenLibraryWork } from './open-library.mapper';
import { OpenLibraryDoc, OpenLibrarySearchResponse, OpenLibraryWork } from './open-library.types';

const BASE_URL = 'https://openlibrary.org';
const SEARCH_FIELDS = 'key,title,author_name,first_publish_year,isbn,cover_i,publisher,language,number_of_pages_median,subject';

@Injectable()
export class OpenLibraryProvider implements IdentifiableProvider {
  readonly key = MetadataProviderKey.OPEN_LIBRARY;
  readonly label = 'OpenLibrary';
  readonly identifiable = true as const;

  private readonly logger = new Logger(OpenLibraryProvider.name);

  constructor(private readonly providerConfig: ProviderConfigService) {}

  async search(params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    const { enabled } = await this.providerConfig.getConfig().then((c) => c.openLibrary);
    if (!enabled) return [];
    const query = this.buildSearchParams(params);
    if (!query) return [];

    query.set('limit', '10');
    query.set('fields', SEARCH_FIELDS);

    const url = `${BASE_URL}/search.json?${query}`;
    const startedAt = Date.now();
    this.logger.log(`[open-library] fetch.start op=search`);
    try {
      const res = await fetchWithThrottle(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        this.logger.warn(`[open-library] fetch.fail op=search status=${res.status} durationMs=${Date.now() - startedAt} message="non-ok response"`);
        return [];
      }

      const body = (await res.json()) as OpenLibrarySearchResponse;
      const items = body.docs.map(mapOpenLibraryDoc);
      this.logger.log(`[open-library] fetch.end op=search status=${res.status} resultCount=${items.length} durationMs=${Date.now() - startedAt}`);
      return items;
    } catch (err) {
      if (err instanceof ProviderThrottleError) {
        this.logger.warn(`[open-library] fetch.fail op=search durationMs=${Date.now() - startedAt} message="throttled"`);
      } else {
        this.logger.warn(
          `[open-library] fetch.fail op=search durationMs=${Date.now() - startedAt} message="${err instanceof Error ? err.message : String(err)}"`,
        );
      }
      throw err;
    }
  }

  async lookupById(providerId: string): Promise<MetadataCandidate | null> {
    const { enabled } = await this.providerConfig.getConfig().then((c) => c.openLibrary);
    if (!enabled) return null;
    const url = `${BASE_URL}/works/${providerId}.json`;
    const startedAt = Date.now();
    this.logger.log(`[open-library] fetch.start op=lookup providerId="${providerId}"`);
    try {
      const res = await fetchWithThrottle(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        this.logger.warn(
          `[open-library] fetch.fail op=lookup providerId="${providerId}" status=${res.status} durationMs=${Date.now() - startedAt} message="non-ok response"`,
        );
        return null;
      }

      const work = (await res.json()) as OpenLibraryWork;
      const mapped = mapOpenLibraryWork(work);
      if (mapped.genres?.length) {
        this.logger.log(
          `[open-library] fetch.end op=lookup providerId="${providerId}" status=${res.status} found=true durationMs=${Date.now() - startedAt}`,
        );
        return mapped;
      }

      const searchGenres = await this.lookupGenresByWorkId(providerId);
      const result = searchGenres?.length ? { ...mapped, genres: searchGenres } : mapped;
      this.logger.log(
        `[open-library] fetch.end op=lookup providerId="${providerId}" status=${res.status} found=${result != null} durationMs=${Date.now() - startedAt}`,
      );
      return result;
    } catch (err) {
      if (err instanceof ProviderThrottleError) {
        this.logger.warn(`[open-library] fetch.fail op=lookup providerId="${providerId}" durationMs=${Date.now() - startedAt} message="throttled"`);
      } else {
        this.logger.warn(
          `[open-library] fetch.fail op=lookup providerId="${providerId}" durationMs=${Date.now() - startedAt} message="${err instanceof Error ? err.message : String(err)}"`,
        );
      }
      throw err;
    }
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

  private async lookupGenresByWorkId(providerId: string): Promise<string[] | undefined> {
    const query = new URLSearchParams({
      q: providerId,
      limit: '20',
      fields: 'key,subject',
    });
    const url = `${BASE_URL}/search.json?${query}`;
    const startedAt = Date.now();
    this.logger.log(`[open-library] fetch.start op=lookup-genres providerId="${providerId}"`);
    try {
      const res = await fetchWithThrottle(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        this.logger.warn(
          `[open-library] fetch.fail op=lookup-genres providerId="${providerId}" status=${res.status} durationMs=${Date.now() - startedAt} message="non-ok response"`,
        );
        return undefined;
      }

      const body = (await res.json()) as Partial<OpenLibrarySearchResponse>;
      if (!Array.isArray(body.docs) || body.docs.length === 0) {
        this.logger.log(
          `[open-library] fetch.end op=lookup-genres providerId="${providerId}" status=${res.status} resultCount=0 durationMs=${Date.now() - startedAt}`,
        );
        return undefined;
      }
      const key = `/works/${providerId}`;
      const doc = body.docs.find((d) => d.key === key);
      const genres = this.extractSubjectGenres(doc);
      this.logger.log(
        `[open-library] fetch.end op=lookup-genres providerId="${providerId}" status=${res.status} resultCount=${genres?.length ?? 0} durationMs=${Date.now() - startedAt}`,
      );
      return genres;
    } catch (err) {
      if (err instanceof ProviderThrottleError) {
        this.logger.warn(
          `[open-library] fetch.fail op=lookup-genres providerId="${providerId}" durationMs=${Date.now() - startedAt} message="throttled"`,
        );
      } else {
        this.logger.warn(
          `[open-library] fetch.fail op=lookup-genres providerId="${providerId}" durationMs=${Date.now() - startedAt} message="${err instanceof Error ? err.message : String(err)}"`,
        );
      }
      throw err;
    }
  }

  private extractSubjectGenres(doc: OpenLibraryDoc | undefined): string[] | undefined {
    if (!doc?.subject?.length) return undefined;
    return doc.subject.slice(0, 10);
  }
}
