import { Injectable, Logger } from '@nestjs/common';
import { MetadataCandidate, MetadataProviderKey } from '@bookorbit/types';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { sanitizeLogValue } from '../../../../common/utils/log-sanitize.utils';
import { fetchWithThrottle } from '../../fetch-with-throttle';
import { ProviderThrottleError } from '../../provider-throttle.error';
import { IdentifiableProvider } from '../metadata-provider';
import { MetadataSearchParams } from '../metadata-search-params';
import { PROVIDER_TIMEOUT_MS } from '../provider-constants';
import { buildRequestSignal } from '../provider-utils';
import { mapAladinItem } from './aladin.mapper';
import { AladinLookupResponse, AladinSearchResponse } from './aladin.types';

const BASE_URL = 'http://www.aladin.co.kr/ttb/api';
const API_VERSION = '20131101';

@Injectable()
export class AladinProvider implements IdentifiableProvider {
  readonly key = MetadataProviderKey.ALADIN;
  readonly label = 'Aladin';
  readonly identifiable = true as const;

  private readonly logger = new Logger(AladinProvider.name);

  constructor(private readonly providerConfig: ProviderConfigService) {}

  async search(params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    const { enabled, ttbKey } = await this.providerConfig.getConfig().then((c) => c.aladin);
    if (!enabled || !ttbKey.trim()) return [];
    const query = this.buildQuery(params);
    if (!query) return [];
    return this.searchItems(query, ttbKey, params.signal);
  }

  async lookupById(providerId: string, signal?: AbortSignal): Promise<MetadataCandidate | null> {
    const { enabled, ttbKey } = await this.providerConfig.getConfig().then((c) => c.aladin);
    if (!enabled || !ttbKey.trim()) return null;
    return this.lookupItem(providerId, ttbKey, signal);
  }

  private buildQuery(params: MetadataSearchParams): string | null {
    if (params.isbn) {
      return params.isbn;
    }
    const parts: string[] = [];
    if (params.title) parts.push(params.title);
    if (params.author) parts.push(params.author);
    return parts.length ? parts.join(' ') : null;
  }

  private async searchItems(query: string, ttbKey: string, signal?: AbortSignal): Promise<MetadataCandidate[]> {
    const url = this.buildSearchUrl(query, ttbKey);
    const startedAt = Date.now();
    const safeQuery = sanitizeLogValue(query);
    this.logger.log(`[aladin] [start] op=search query="${safeQuery}"`);

    try {
      const res = await fetchWithThrottle(url, { signal: buildRequestSignal(PROVIDER_TIMEOUT_MS.DEFAULT, signal) });
      if (!res.ok) {
        this.logger.warn(
          `[aladin] [fail] op=search query="${safeQuery}" status=${res.status} durationMs=${Date.now() - startedAt} message="non-ok response"`,
        );
        return [];
      }
      const body = (await res.json()) as AladinSearchResponse;
      const items = (body.item ?? []).map(mapAladinItem);
      this.logger.log(
        `[aladin] [end] op=search query="${safeQuery}" status=${res.status} resultCount=${items.length} durationMs=${Date.now() - startedAt}`,
      );
      return items;
    } catch (err) {
      if (err instanceof ProviderThrottleError) {
        this.logger.warn(`[aladin] [fail] op=search query="${safeQuery}" durationMs=${Date.now() - startedAt} message="throttled"`);
        throw err;
      }
      this.logger.warn(
        `[aladin] [fail] op=search query="${safeQuery}" durationMs=${Date.now() - startedAt} message="${err instanceof Error ? err.message : String(err)}"`,
      );
      throw err;
    }
  }

  private async lookupItem(providerId: string, ttbKey: string, signal?: AbortSignal): Promise<MetadataCandidate | null> {
    const url = this.buildLookupUrl(providerId, ttbKey);
    const startedAt = Date.now();
    this.logger.log(`[aladin] [start] op=lookup providerId="${providerId}"`);

    try {
      const res = await fetchWithThrottle(url, { signal: buildRequestSignal(PROVIDER_TIMEOUT_MS.DEFAULT, signal) });
      if (!res.ok) {
        this.logger.warn(
          `[aladin] [fail] op=lookup providerId="${providerId}" status=${res.status} durationMs=${Date.now() - startedAt} message="non-ok response"`,
        );
        return null;
      }
      const body = (await res.json()) as AladinLookupResponse;
      const item = body.item?.[0];
      if (!item) {
        this.logger.log(`[aladin] [end] op=lookup providerId="${providerId}" status=${res.status} found=false durationMs=${Date.now() - startedAt}`);
        return null;
      }
      const mapped = mapAladinItem(item);
      this.logger.log(`[aladin] [end] op=lookup providerId="${providerId}" status=${res.status} found=true durationMs=${Date.now() - startedAt}`);
      return mapped;
    } catch (err) {
      if (err instanceof ProviderThrottleError) {
        this.logger.warn(`[aladin] [fail] op=lookup providerId="${providerId}" durationMs=${Date.now() - startedAt} message="throttled"`);
        throw err;
      }
      this.logger.warn(
        `[aladin] [fail] op=lookup providerId="${providerId}" durationMs=${Date.now() - startedAt} message="${err instanceof Error ? err.message : String(err)}"`,
      );
      throw err;
    }
  }

  private buildSearchUrl(query: string, ttbKey: string): string {
    const params = new URLSearchParams({
      TTBKey: ttbKey,
      Query: query,
      QueryType: 'Keyword',
      MaxResults: '10',
      start: '1',
      SearchTarget: 'Book',
      output: 'JS',
      Version: API_VERSION,
      Cover: 'Big',
      OptResult: 'ebookList,usedList,reviewList,fullDescription,categoryIdList,seriesInfo,authors',
    });
    return `${BASE_URL}/ItemSearch.aspx?${params.toString()}`;
  }

  private buildLookupUrl(providerId: string, ttbKey: string): string {
    const isIsbn13 = providerId.length === 13;
    const params = new URLSearchParams({
      TTBKey: ttbKey,
      ItemId: providerId,
      ItemIdType: isIsbn13 ? 'ISBN13' : 'ISBN',
      output: 'JS',
      Version: API_VERSION,
      Cover: 'Big',
      OptResult: 'ebookList,usedList,reviewList,fullDescription,categoryIdList,seriesInfo,authors,toc,packing,subbarcode',
    });
    return `${BASE_URL}/ItemLookUp.aspx?${params.toString()}`;
  }
}
