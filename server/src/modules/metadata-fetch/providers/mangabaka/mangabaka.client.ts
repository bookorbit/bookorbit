import { Injectable, Logger } from '@nestjs/common';

import { sanitizeLogValue } from '../../../../common/utils/log-sanitize.utils';
import { fetchWithThrottle } from '../../fetch-with-throttle';
import { ProviderThrottleError } from '../../provider-throttle.error';
import { PROVIDER_DELAYS_MS, PROVIDER_TIMEOUT_MS } from '../provider-constants';
import { buildRequestSignal, sleep } from '../provider-utils';
import { MangabakaCollection, MangabakaEnvelope, MangabakaPagination, MangabakaSeries, MangabakaWork } from './mangabaka.types';

const BASE_URL = 'https://api.mangabaka.org';
const USER_AGENT = 'bookorbit/1.0 (+https://github.com/bookorbit/bookorbit)';

const COLLECTIONS_CACHE_TTL_MS = 10 * 60 * 1000;
const COLLECTIONS_CACHE_MAX_SIZE = 500;

/**
 * Simple LRU map that evicts the oldest entry when size exceeds maxSize.
 * Uses Map's insertion order: on get, delete+re-set to move to end.
 */
class LruMap<V> {
  private readonly map = new Map<number, V>();

  constructor(private readonly maxSize: number) {}

  get(key: number): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: number, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      // Evict oldest (first key in insertion order)
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }
    this.map.set(key, value);
  }

  delete(key: number): void {
    this.map.delete(key);
  }
}

class RateLimiter {
  private nextAllowedTime = 0;

  async throttle(signal?: AbortSignal): Promise<void> {
    const now = Date.now();
    const scheduled = Math.max(now, this.nextAllowedTime);
    this.nextAllowedTime = scheduled + PROVIDER_DELAYS_MS.MANGABAKA_BETWEEN_REQUESTS;
    const wait = scheduled - now;
    if (wait > 0) {
      await sleep(wait, signal);
    }
  }
}

@Injectable()
export class MangabakaClient {
  private readonly logger = new Logger(MangabakaClient.name);
  private readonly rateLimiter = new RateLimiter();
  private readonly collectionsCache = new LruMap<{ collections: MangabakaCollection[]; expiresAt: number }>(COLLECTIONS_CACHE_MAX_SIZE);

  async match(query: string, limit: number, signal?: AbortSignal): Promise<MangabakaSeries[]> {
    const params = new URLSearchParams({
      q: query,
      limit: String(limit),
    });
    const envelope = await this.get<MangabakaEnvelope<MangabakaSeries[]>>('match', `/v1/series/match?${params.toString()}`, signal);
    return envelope?.data ?? [];
  }

  async search(query: string, limit: number, signal?: AbortSignal): Promise<MangabakaSeries[]> {
    const params = new URLSearchParams({
      q: query,
      limit: String(limit),
    });
    const envelope = await this.get<MangabakaEnvelope<MangabakaSeries[]>>('search', `/v1/series/search?${params.toString()}`, signal);
    return envelope?.data ?? [];
  }

  async fetchSeries(id: number, signal?: AbortSignal): Promise<MangabakaSeries | null> {
    const envelope = await this.get<MangabakaEnvelope<MangabakaSeries>>('fetchSeries', `/v1/series/${id}`, signal);
    if (!envelope?.data) return null;
    return envelope.data;
  }

  async fetchCollections(seriesId: number, signal?: AbortSignal): Promise<MangabakaCollection[]> {
    const cached = this.collectionsCache.get(seriesId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.collections;
    }

    const envelope = await this.get<MangabakaEnvelope<MangabakaCollection[]>>('fetchCollections', `/v1/series/${seriesId}/collections`, signal);
    const collections = envelope?.data ?? [];
    this.collectionsCache.set(seriesId, { collections, expiresAt: Date.now() + COLLECTIONS_CACHE_TTL_MS });
    return collections;
  }

  async fetchWorks(collectionId: string, signal?: AbortSignal, targetSequence?: number): Promise<MangabakaWork[]> {
    const limit = 50;
    const firstEnvelope = await this.get<MangabakaEnvelope<MangabakaWork[]> & { pagination: MangabakaPagination }>(
      'fetchWorks',
      `/v1/collections/${collectionId}/works?limit=${limit}&page=1`,
      signal,
    );
    if (!firstEnvelope?.data) return [];

    const allWorks = [...firstEnvelope.data];

    // Early exit if target found on first page
    if (targetSequence !== undefined && allWorks.some((w) => w.sequence_numeric === targetSequence)) {
      return allWorks;
    }

    const pagination = firstEnvelope.pagination;
    if (pagination && pagination.count > limit) {
      const totalPages = Math.ceil(pagination.count / limit);
      const cappedTotalPages = Math.min(totalPages, 50);
      if (totalPages > 50) {
        this.logger.warn(
          `[MangaBaka.fetchWorks] [end] collectionId="${sanitizeLogValue(collectionId)}" totalPages=${totalPages} capped=true - capped pagination`,
        );
      }
      for (let page = 2; page <= cappedTotalPages; page++) {
        if (signal?.aborted) {
          this.logger.log(
            `[MangaBaka.fetchWorks] [end] collectionId="${sanitizeLogValue(collectionId)}" page=${page} aborted=true worksSoFar=${allWorks.length} - fetch works aborted mid-pagination`,
          );
          return allWorks;
        }
        const envelope = await this.get<MangabakaEnvelope<MangabakaWork[]> & { pagination: MangabakaPagination }>(
          'fetchWorks',
          `/v1/collections/${collectionId}/works?limit=${limit}&page=${page}`,
          signal,
        );
        if (envelope?.data) {
          allWorks.push(...envelope.data);
          // Early exit if target found on this page
          if (targetSequence !== undefined && envelope.data.some((w) => w.sequence_numeric === targetSequence)) {
            return allWorks;
          }
        } else {
          this.logger.warn(
            `[MangaBaka.fetchWorks] [fail] page=${page} collectionId="${sanitizeLogValue(collectionId)}" errorClass=HttpError error="page fetch returned null"`,
          );
        }
      }
    }

    return allWorks;
  }

  async fetchWork(workId: string, signal?: AbortSignal): Promise<MangabakaWork | null> {
    const envelope = await this.get<MangabakaEnvelope<MangabakaWork>>('fetchWork', `/v1/works/${workId}`, signal);
    if (!envelope?.data) return null;
    return envelope.data;
  }

  private async get<T>(op: string, path: string, signal?: AbortSignal): Promise<T | null> {
    await this.rateLimiter.throttle(signal);
    const startedAt = Date.now();
    this.logger.log(`[MangaBaka.${op}] [start] path="${sanitizeLogValue(path)}"`);

    try {
      const res = await fetchWithThrottle(`${BASE_URL}${path}`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: buildRequestSignal(PROVIDER_TIMEOUT_MS.DEFAULT, signal),
      });

      if (!res.ok) {
        this.logger.warn(
          `[MangaBaka.${op}] [fail] status=${res.status} durationMs=${Date.now() - startedAt} errorClass=HttpError error="non-ok response"`,
        );
        return null;
      }

      const body = (await res.json()) as T;
      this.logger.log(`[MangaBaka.${op}] [end] status=${res.status} durationMs=${Date.now() - startedAt}`);
      return body;
    } catch (err) {
      if (err instanceof ProviderThrottleError) {
        this.logger.warn(`[MangaBaka.${op}] [fail] durationMs=${Date.now() - startedAt} errorClass=ThrottleError error="throttled"`);
        throw err;
      }
      const errorClass = err instanceof Error ? err.constructor.name : 'Unknown';
      this.logger.warn(`[MangaBaka.${op}] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(err)}"`);
      return null;
    }
  }
}
