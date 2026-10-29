import { Injectable } from '@nestjs/common';
import { METADATA_HTTP_PROVIDER_ICON_MAX_BYTES } from '@bookorbit/types';

import { providerRequestKey, recordProviderRequest, recordProviderRequestError } from '../../common/provider-cache/provider-call-context';
import { safeFetch } from '../../common/utils/safe-fetch';

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

/** How to reach one provider. `authorization` is already decrypted; never log it. */
export interface HttpProviderTarget {
  key: string;
  baseUrl: string;
  authorization: string | null;
  allowPrivateAddress: boolean;
  timeoutMs: number;
  rateLimit: { maxConcurrency: number; minIntervalMs: number };
}

export type HttpProviderErrorKind = 'throttled' | 'unauthorized' | 'failed';

/**
 * A provider call that did not produce an answer. The kind decides how BookOrbit reacts: a
 * throttle starts the provider's cooldown, anything else counts as a failed call.
 */
export class HttpProviderError extends Error {
  constructor(
    readonly kind: HttpProviderErrorKind,
    message: string,
    readonly status?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'HttpProviderError';
  }
}

/**
 * The only path from BookOrbit to an external provider. Every request goes through `safeFetch` with
 * the row's private-address policy, re-checks each redirect, is bounded in time and size, and is
 * recorded for the metadata cache the way `fetchWithThrottle` records built-in providers' requests.
 */
@Injectable()
export class HttpProviderClient {
  private readonly limiters = new Map<string, ProviderLimiter>();

  async getInfo(target: HttpProviderTarget): Promise<unknown> {
    return this.get(target, 'provider/info', undefined, false);
  }

  async search(target: HttpProviderTarget, query: URLSearchParams, signal?: AbortSignal): Promise<unknown> {
    return this.get(target, 'search', query, false, signal);
  }

  /** Null when the provider answers 404: an authoritative "no such record". */
  async lookup(target: HttpProviderTarget, id: string, signal?: AbortSignal): Promise<unknown | null> {
    // encodeURIComponent leaves dots alone, and `book/..` would resolve to the provider's root.
    if (id === '.' || id === '..') return null;
    return this.get(target, `book/${encodeURIComponent(id)}`, undefined, true, signal);
  }

  /**
   * The provider's icon from its `avatarUrl`, under the same address policy as every other call.
   * Only raster formats are kept: an SVG can carry script, and BookOrbit serves the bytes itself.
   */
  async getIcon(target: HttpProviderTarget, url: string): Promise<{ data: Buffer; contentType: string }> {
    const res = await this.fetchFollowingRedirects(target, new URL(url), undefined, 'image/png, image/webp, image/jpeg, image/gif, image/x-icon');
    if (!res.ok) {
      await res.body?.cancel();
      throw new HttpProviderError('failed', `icon answered ${res.status}`, res.status);
    }
    const data = await readBounded(res, METADATA_HTTP_PROVIDER_ICON_MAX_BYTES, 'icon is too large');
    const contentType = sniffImageType(data);
    if (!contentType) throw new HttpProviderError('failed', 'icon is not a PNG, WebP, JPEG, GIF or ICO image', res.status);
    return { data, contentType };
  }

  /** Drop a provider's limiter, so new rate settings apply to the next call. */
  forget(key: string): void {
    this.limiters.delete(key);
  }

  private async get(
    target: HttpProviderTarget,
    path: string,
    query: URLSearchParams | undefined,
    notFoundIsAnswer: boolean,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const url = new URL(path, target.baseUrl.endsWith('/') ? target.baseUrl : `${target.baseUrl}/`);
    if (query) url.search = query.toString();
    const requestKey = providerRequestKey(url);
    const release = await this.limiterFor(target).acquire(signal);
    try {
      const res = await this.fetchFollowingRedirects(target, url, signal);
      recordProviderRequest(requestKey, { kind: 'status', status: res.status, accepted: notFoundIsAnswer && res.status === 404 });
      if (notFoundIsAnswer && res.status === 404) {
        await res.body?.cancel();
        return null;
      }
      if (res.status === 429) {
        await res.body?.cancel();
        throw new HttpProviderError('throttled', 'provider answered 429', 429, parseRetryAfter(res.headers.get('retry-after')));
      }
      if (res.status === 401 || res.status === 403) {
        await res.body?.cancel();
        throw new HttpProviderError('unauthorized', `provider answered ${res.status}`, res.status);
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw new HttpProviderError('failed', `provider answered ${res.status}`, res.status);
      }
      return await readJson(res);
    } catch (error) {
      if (!(error instanceof HttpProviderError)) recordProviderRequestError(requestKey, error);
      throw error;
    } finally {
      release();
    }
  }

  private async fetchFollowingRedirects(
    target: HttpProviderTarget,
    start: URL,
    signal?: AbortSignal,
    accept = 'application/json',
  ): Promise<Response> {
    const timeout = AbortSignal.timeout(target.timeoutMs);
    const combined = signal ? AbortSignal.any([timeout, signal]) : timeout;
    const headers: Record<string, string> = { Accept: accept, 'User-Agent': 'BookOrbit' };
    // The credential is for the provider; an icon hosted elsewhere never sees it.
    if (target.authorization && start.origin === new URL(target.baseUrl).origin) headers.Authorization = target.authorization;

    let url = start;
    for (let hop = 0; ; hop++) {
      const res = await safeFetch(
        url.toString(),
        { headers, signal: combined, redirect: 'manual' },
        { allowPrivate: target.allowPrivateAddress, pinResolvedAddress: true },
      );
      if (res.status < 300 || res.status >= 400) return res;
      const location = res.headers.get('location');
      await res.body?.cancel();
      if (!location) throw new HttpProviderError('failed', `provider redirect ${res.status} without a location`, res.status);
      if (hop >= MAX_REDIRECTS) throw new HttpProviderError('failed', 'provider redirected too many times', res.status);
      const next = new URL(location, url);
      // A redirect must not carry the provider's credential to another host.
      if (next.origin !== start.origin) delete headers.Authorization;
      url = next;
    }
  }

  private limiterFor(target: HttpProviderTarget): ProviderLimiter {
    const existing = this.limiters.get(target.key);
    if (existing?.matches(target.rateLimit)) return existing;
    const limiter = new ProviderLimiter(target.rateLimit.maxConcurrency, target.rateLimit.minIntervalMs);
    this.limiters.set(target.key, limiter);
    return limiter;
  }
}

async function readJson(res: Response): Promise<unknown> {
  if (!res.body) return null;
  const body = await readBounded(res, MAX_BODY_BYTES, 'provider response is too large');
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new HttpProviderError('failed', 'provider response is not JSON', res.status);
  }
}

/** The whole body, refused as soon as it passes `max` bytes, declared or not. */
async function readBounded(res: Response, max: number, tooLarge: string): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel();
    throw new HttpProviderError('failed', tooLarge, res.status);
  }
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new HttpProviderError('failed', tooLarge, res.status);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** The image type the bytes themselves say, whatever the server's Content-Type claimed. */
export function sniffImageType(data: Buffer): string | null {
  const starts = (...bytes: number[]) => bytes.every((byte, i) => data[i] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (data.subarray(0, 6).toString('latin1') === 'GIF87a' || data.subarray(0, 6).toString('latin1') === 'GIF89a') return 'image/gif';
  if (data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (starts(0x00, 0x00, 0x01, 0x00)) return 'image/x-icon';
  return null;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
  const at = Date.parse(value);
  if (Number.isNaN(at)) return undefined;
  const remaining = Math.ceil((at - Date.now()) / 1000);
  return remaining > 0 ? remaining : undefined;
}

/** At most `concurrency` calls in flight, each starting at least `intervalMs` after the previous. */
class ProviderLimiter {
  private active = 0;
  private nextStart = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    private readonly concurrency: number,
    private readonly intervalMs: number,
  ) {}

  matches(rateLimit: { maxConcurrency: number; minIntervalMs: number }): boolean {
    return rateLimit.maxConcurrency === this.concurrency && rateLimit.minIntervalMs === this.intervalMs;
  }

  async acquire(signal?: AbortSignal): Promise<() => void> {
    while (this.active >= this.concurrency) {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          const index = this.waiting.indexOf(wake);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(signal?.reason instanceof Error ? signal.reason : new Error('aborted'));
        };
        const wake = () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        };
        if (signal?.aborted) return onAbort();
        signal?.addEventListener('abort', onAbort, { once: true });
        this.waiting.push(wake);
      });
    }
    this.active++;
    const wait = this.nextStart - Date.now();
    this.nextStart = Math.max(Date.now(), this.nextStart) + this.intervalMs;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.waiting.shift()?.();
    };
  }
}
