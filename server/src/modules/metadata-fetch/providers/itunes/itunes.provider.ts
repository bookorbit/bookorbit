import { Injectable, Logger } from '@nestjs/common';
import { MetadataCandidate, MetadataProviderKey } from '@projectx/types';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { fetchWithThrottle } from '../../fetch-with-throttle';
import { ProviderThrottleError } from '../../provider-throttle.error';
import { IdentifiableProvider } from '../metadata-provider';
import { MetadataSearchParams } from '../metadata-search-params';
import { mapITunesResult } from './itunes.mapper';
import { ITunesResponse } from './itunes.types';

const SEARCH_URL = 'https://itunes.apple.com/search';
const LOOKUP_URL = 'https://itunes.apple.com/lookup';

@Injectable()
export class ITunesProvider implements IdentifiableProvider {
  readonly key = MetadataProviderKey.ITUNES;
  readonly label = 'iTunes';
  readonly identifiable = true as const;

  private readonly logger = new Logger(ITunesProvider.name);

  constructor(private readonly providerConfig: ProviderConfigService) {}

  async search(params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    const { enabled } = await this.providerConfig.getConfig().then((c) => c.itunes);
    if (!enabled) return [];

    const query = this.buildQuery(params);
    if (!query) return [];

    const url = new URL(SEARCH_URL);
    url.searchParams.set('term', query);
    url.searchParams.set('entity', params.isAudiobook ? 'audiobook' : 'ebook');
    url.searchParams.set('limit', '10');
    const requestUrl = url.toString();
    const startedAt = Date.now();
    this.logger.log(`[itunes] fetch.start op=search query="${query}"`);

    try {
      const res = await fetchWithThrottle(requestUrl, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        this.logger.warn(
          `[itunes] fetch.fail op=search query="${query}" status=${res.status} durationMs=${Date.now() - startedAt} message="non-ok response"`,
        );
        return [];
      }
      const body = (await res.json()) as ITunesResponse;
      const results = body.results.map(mapITunesResult);
      this.logger.log(
        `[itunes] fetch.end op=search query="${query}" status=${res.status} resultCount=${results.length} durationMs=${Date.now() - startedAt}`,
      );
      return results;
    } catch (err) {
      if (err instanceof ProviderThrottleError) {
        this.logger.warn(`[itunes] fetch.fail op=search query="${query}" durationMs=${Date.now() - startedAt} message="throttled"`);
        throw err;
      }
      this.logger.error(
        `[itunes] fetch.fail op=search query="${query}" durationMs=${Date.now() - startedAt} message="${err instanceof Error ? err.message : String(err)}"`,
      );
      return [];
    }
  }

  async lookupById(providerId: string): Promise<MetadataCandidate | null> {
    const { enabled } = await this.providerConfig.getConfig().then((c) => c.itunes);
    if (!enabled) return null;

    const url = new URL(LOOKUP_URL);
    url.searchParams.set('id', providerId);
    const requestUrl = url.toString();
    const startedAt = Date.now();
    this.logger.log(`[itunes] fetch.start op=lookup providerId="${providerId}"`);

    try {
      const res = await fetchWithThrottle(requestUrl, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        this.logger.warn(
          `[itunes] fetch.fail op=lookup providerId="${providerId}" status=${res.status} durationMs=${Date.now() - startedAt} message="non-ok response"`,
        );
        return null;
      }
      const body = (await res.json()) as ITunesResponse;
      const result = body.results.length > 0 ? mapITunesResult(body.results[0]) : null;
      this.logger.log(
        `[itunes] fetch.end op=lookup providerId="${providerId}" status=${res.status} found=${result != null} durationMs=${Date.now() - startedAt}`,
      );
      return result;
    } catch (err) {
      if (err instanceof ProviderThrottleError) {
        this.logger.warn(`[itunes] fetch.fail op=lookup providerId="${providerId}" durationMs=${Date.now() - startedAt} message="throttled"`);
        throw err;
      }
      this.logger.error(
        `[itunes] fetch.fail op=lookup providerId="${providerId}" durationMs=${Date.now() - startedAt} message="${err instanceof Error ? err.message : String(err)}"`,
      );
      return null;
    }
  }

  private buildQuery(params: MetadataSearchParams): string | null {
    if (params.isbn) return params.isbn;
    const parts: string[] = [];
    if (params.title) parts.push(params.title);
    if (params.author) parts.push(params.author);
    return parts.length ? parts.join(' ') : null;
  }
}
