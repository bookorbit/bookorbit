import { Injectable, Logger } from '@nestjs/common';

import { fetchWithThrottle } from '../../fetch-with-throttle';
import { ProviderThrottleError } from '../../provider-throttle.error';
import { PROVIDER_DELAYS_MS, PROVIDER_TIMEOUT_MS } from '../provider-constants';
import { buildRequestSignal, sanitizeLogError, sleep } from '../provider-utils';
import { RanobeDbBookResponse, RanobeDbSearchResponse } from './ranobedb.types';

const BASE_URL = 'https://ranobedb.org/api/v0';
const USER_AGENT = 'bookorbit/1.0 (+https://github.com/bookorbit/bookorbit)';

class RateLimiter {
  private nextAllowedTime = 0;

  async throttle(signal?: AbortSignal): Promise<void> {
    const now = Date.now();
    const scheduled = Math.max(now, this.nextAllowedTime);
    this.nextAllowedTime = scheduled + PROVIDER_DELAYS_MS.RANOBEDB_BETWEEN_REQUESTS;
    const wait = scheduled - now;
    if (wait > 0) {
      await sleep(wait, signal);
    }
  }
}

@Injectable()
export class RanobeDbClient {
  private readonly logger = new Logger(RanobeDbClient.name);
  private readonly rateLimiter = new RateLimiter();

  async search(query: string, signal?: AbortSignal): Promise<number[]> {
    const params = new URLSearchParams({
      q: query,
      limit: '5',
    });
    const body = await this.get<RanobeDbSearchResponse>('search', `/books?${params.toString()}`, signal);
    return body?.books?.map((b) => b.id) ?? [];
  }

  async fetchBook(id: number, signal?: AbortSignal): Promise<RanobeDbBookResponse | null> {
    return this.get<RanobeDbBookResponse>('fetchBook', `/book/${id}`, signal);
  }

  private async get<T>(op: string, path: string, signal?: AbortSignal): Promise<T | null> {
    await this.rateLimiter.throttle(signal);
    const startedAt = Date.now();
    this.logger.log(`[ranobedb] [start] op=${op} path=${path}`);

    try {
      const res = await fetchWithThrottle(`${BASE_URL}${path}`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: buildRequestSignal(PROVIDER_TIMEOUT_MS.DEFAULT, signal),
      });

      if (!res.ok) {
        this.logger.warn(`[ranobedb] [fail] op=${op} status=${res.status} durationMs=${Date.now() - startedAt} error="non-ok response"`);
        return null;
      }

      const body = (await res.json()) as T;
      this.logger.log(`[ranobedb] [end] op=${op} status=${res.status} durationMs=${Date.now() - startedAt}`);
      return body;
    } catch (err) {
      if (err instanceof ProviderThrottleError) {
        this.logger.warn(`[ranobedb] [fail] op=${op} durationMs=${Date.now() - startedAt} error="throttled"`);
        throw err;
      }
      this.logger.warn(`[ranobedb] [fail] op=${op} durationMs=${Date.now() - startedAt} error="${sanitizeLogError(err)}"`);
      return null;
    }
  }
}
