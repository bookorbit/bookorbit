import { Injectable, Logger } from '@nestjs/common';

import { fetchWithThrottle } from '../../fetch-with-throttle';
import { ProviderThrottleError } from '../../provider-throttle.error';
import { ComicVineApiResponse, ComicVineIssue, ComicVineVolume } from './comicvine.types';

const BASE_URL = 'https://comicvine.gamespot.com/api';
const REQUEST_TIMEOUT_MS = 15_000;
const RATE_LIMIT_DELAY_MS = 1_000;
const VOLUME_CACHE_TTL_MS = 10 * 60 * 1_000;
const VOLUME_CACHE_MAX_SIZE = 50;

const USER_AGENT = 'ProjectX/1.0 (Book and Comic Library Manager)';

const VOLUME_FIELDS = 'id,name,publisher,start_year,count_of_issues,description,deck,image,site_detail_url';
const ISSUE_LIST_FIELDS =
  'id,name,issue_number,cover_date,description,deck,image,volume,site_detail_url,person_credits,character_credits,team_credits,story_arc_credits,location_credits';
const ISSUE_DETAIL_FIELDS = ISSUE_LIST_FIELDS;
const SEARCH_FIELDS = `${VOLUME_FIELDS},${ISSUE_LIST_FIELDS}`;

interface CachedVolumes {
  data: ComicVineVolume[];
  expiresAt: number;
}

class RateLimiter {
  private nextAllowedTime = 0;

  async throttle(): Promise<void> {
    const now = Date.now();
    const scheduled = Math.max(now, this.nextAllowedTime);
    this.nextAllowedTime = scheduled + RATE_LIMIT_DELAY_MS;
    const wait = scheduled - now;
    if (wait > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, wait));
    }
  }
}

@Injectable()
export class ComicVineClient {
  private readonly logger = new Logger(ComicVineClient.name);
  private readonly rateLimiter = new RateLimiter();
  private readonly volumeCache = new Map<string, CachedVolumes>();

  async searchVolumes(seriesName: string, apiKey: string): Promise<ComicVineVolume[]> {
    const cacheKey = seriesName.toLowerCase().trim();
    const cached = this.volumeCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const url = this.buildUrl('/volumes/', apiKey, {
      filter: `name:${seriesName}`,
      field_list: VOLUME_FIELDS,
      limit: '20',
    });

    const data = await this.get<ComicVineVolume[]>(url);
    if (data) {
      this.cacheVolumes(cacheKey, data);
    }
    return data ?? [];
  }

  async searchIssuesInVolume(volumeId: number, issueNumber: string, apiKey: string): Promise<ComicVineIssue[]> {
    const url = this.buildUrl('/issues/', apiKey, {
      filter: `volume:${volumeId},issue_number:${issueNumber}`,
      field_list: ISSUE_LIST_FIELDS,
      limit: '5',
    });

    return (await this.get<ComicVineIssue[]>(url)) ?? [];
  }

  async searchIssues(query: string, apiKey: string): Promise<ComicVineIssue[]> {
    const url = this.buildUrl('/search/', apiKey, {
      query,
      resources: 'issue',
      field_list: SEARCH_FIELDS,
      limit: '10',
    });

    return (await this.get<ComicVineIssue[]>(url)) ?? [];
  }

  async getIssueById(issueId: string, apiKey: string): Promise<ComicVineIssue | null> {
    const url = this.buildUrl(`/issue/4000-${issueId}/`, apiKey, {
      field_list: ISSUE_DETAIL_FIELDS,
    });

    return this.get<ComicVineIssue>(url);
  }

  private async get<T>(url: URL): Promise<T | null> {
    await this.rateLimiter.throttle();
    const startedAt = Date.now();
    this.logger.log(`[comicvine] fetch.start method=GET`);

    try {
      const res = await fetchWithThrottle(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (res.status === 420) {
        this.logger.warn(`[comicvine] fetch.fail method=GET status=420 durationMs=${Date.now() - startedAt} message="throttled"`);
        throw new ProviderThrottleError();
      }

      if (!res.ok) {
        this.logger.warn(`[comicvine] fetch.fail method=GET status=${res.status} durationMs=${Date.now() - startedAt} message="non-ok response"`);
        return null;
      }

      const body = (await res.json()) as ComicVineApiResponse<T>;
      if (body.status_code !== 1) {
        this.logger.warn(`[comicvine] fetch.fail method=GET status=${res.status} durationMs=${Date.now() - startedAt} message="${body.error}"`);
        return null;
      }

      const resultCount = Array.isArray(body.results) ? body.results.length : body.results ? 1 : 0;
      this.logger.log(`[comicvine] fetch.end method=GET status=${res.status} resultCount=${resultCount} durationMs=${Date.now() - startedAt}`);
      return body.results;
    } catch (err) {
      if (err instanceof ProviderThrottleError) throw err;
      this.logger.warn(`[comicvine] fetch.fail method=GET durationMs=${Date.now() - startedAt} message="${(err as Error).message}"`);
      return null;
    }
  }

  private buildUrl(path: string, apiKey: string, params: Record<string, string>): URL {
    const url = new URL(`${BASE_URL}${path}`);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('format', 'json');
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    return url;
  }

  private cacheVolumes(key: string, data: ComicVineVolume[]): void {
    if (this.volumeCache.size >= VOLUME_CACHE_MAX_SIZE) {
      const oldest = this.volumeCache.keys().next().value;
      if (oldest) this.volumeCache.delete(oldest);
    }
    this.volumeCache.set(key, { data, expiresAt: Date.now() + VOLUME_CACHE_TTL_MS });
  }
}
