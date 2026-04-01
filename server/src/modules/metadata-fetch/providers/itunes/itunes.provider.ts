import { Injectable, Logger } from '@nestjs/common';
import { MetadataCandidate, MetadataProviderKey } from '@projectx/types';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { fetchWithThrottle } from '../../fetch-with-throttle';
import { ProviderThrottleError } from '../../provider-throttle.error';
import { IdentifiableProvider } from '../metadata-provider';
import { MetadataSearchParams } from '../metadata-search-params';
import { PROVIDER_TIMEOUT_MS } from '../provider-constants';
import { buildRequestSignal } from '../provider-utils';
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
    const { enabled, coverResolution } = await this.providerConfig.getConfig().then((c) => c.itunes);
    if (!enabled) return [];

    const query = this.buildQuery(params);
    if (!query) return [];

    const url = new URL(SEARCH_URL);
    url.searchParams.set('term', query);
    url.searchParams.set('entity', params.isAudiobook ? 'audiobook' : 'ebook');
    url.searchParams.set('limit', '10');
    const requestUrl = url.toString();
    const startedAt = Date.now();
    this.logger.log(`[itunes] [start] op=search query="${query}"`);

    try {
      const res = await fetchWithThrottle(requestUrl, { signal: buildRequestSignal(PROVIDER_TIMEOUT_MS.DEFAULT, params.signal) });
      if (!res.ok) {
        this.logger.warn(
          `[itunes] [fail] op=search query="${query}" status=${res.status} durationMs=${Date.now() - startedAt} message="non-ok response"`,
        );
        return [];
      }
      const body = (await res.json()) as ITunesResponse;
      const results = body.results
        .map((r) => {
          try {
            return mapITunesResult(r, coverResolution);
          } catch (err) {
            this.logger.warn(`[itunes] skipping result due to error: ${err instanceof Error ? err.message : String(err)}`);
            return null;
          }
        })
        .filter((r): r is MetadataCandidate => r !== null);

      this.logger.log(
        `[itunes] [end] op=search query="${query}" status=${res.status} resultCount=${results.length} durationMs=${Date.now() - startedAt}`,
      );
      return results;
    } catch (err) {
      if (err instanceof ProviderThrottleError) {
        this.logger.warn(`[itunes] [fail] op=search query="${query}" durationMs=${Date.now() - startedAt} message="throttled"`);
        throw err;
      }
      this.logger.error(
        `[itunes] [fail] op=search query="${query}" durationMs=${Date.now() - startedAt} message="${err instanceof Error ? err.message : String(err)}"`,
      );
      return [];
    }
  }

  async lookupById(providerId: string, signal?: AbortSignal): Promise<MetadataCandidate | null> {
    const { enabled, coverResolution } = await this.providerConfig.getConfig().then((c) => c.itunes);
    if (!enabled) return null;

    const url = new URL(LOOKUP_URL);
    url.searchParams.set('id', providerId);
    const requestUrl = url.toString();
    const startedAt = Date.now();
    this.logger.log(`[itunes] [start] op=lookup providerId="${providerId}"`);

    try {
      const res = await fetchWithThrottle(requestUrl, { signal: buildRequestSignal(PROVIDER_TIMEOUT_MS.DEFAULT, signal) });
      if (!res.ok) {
        this.logger.warn(
          `[itunes] [fail] op=lookup providerId="${providerId}" status=${res.status} durationMs=${Date.now() - startedAt} message="non-ok response"`,
        );
        return null;
      }
      const body = (await res.json()) as ITunesResponse;
      let result: MetadataCandidate | null = null;
      if (body.results.length > 0) {
        try {
          result = mapITunesResult(body.results[0], coverResolution);
        } catch (err) {
          this.logger.warn(`[itunes] failed to map lookup result providerId="${providerId}": ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      this.logger.log(
        `[itunes] [end] op=lookup providerId="${providerId}" status=${res.status} found=${result != null} durationMs=${Date.now() - startedAt}`,
      );
      return result;
    } catch (err) {
      if (err instanceof ProviderThrottleError) {
        this.logger.warn(`[itunes] [fail] op=lookup providerId="${providerId}" durationMs=${Date.now() - startedAt} message="throttled"`);
        throw err;
      }
      this.logger.error(
        `[itunes] [fail] op=lookup providerId="${providerId}" durationMs=${Date.now() - startedAt} message="${err instanceof Error ? err.message : String(err)}"`,
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
