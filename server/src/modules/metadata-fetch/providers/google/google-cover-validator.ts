import { createHash } from 'crypto';

import type { MetadataCandidate } from '@bookorbit/types';

import { buildRequestSignal } from '../provider-utils';

const GOOGLE_BOOKS_COVER_HOST = 'books.google.com';
const VALIDATION_TIMEOUT_MS = 2_000;
const VALIDATION_CONCURRENCY = 5;
const MAX_FINGERPRINT_BYTES = 32 * 1024;
const CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const CACHE_MAX_ENTRIES = 500;

const GOOGLE_BOOKS_PLACEHOLDER_LENGTHS = new Set([9_103]);
const GOOGLE_BOOKS_PLACEHOLDER_HASHES = new Set(['3efa8c43e5b4348f303a528c81adf435f0111ea752fe9f0f6241478b60987fa6']);

type FetchImage = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface GoogleCoverValidatorOptions {
  fetchImage?: FetchImage;
  placeholderLengths?: ReadonlySet<number>;
  placeholderHashes?: ReadonlySet<string>;
}

interface CachedValidation {
  usable: boolean;
  expiresAt: number;
}

export class GoogleCoverValidator {
  private readonly cache = new Map<string, CachedValidation>();
  private readonly fetchImage: FetchImage;
  private readonly placeholderLengths: ReadonlySet<number>;
  private readonly placeholderHashes: ReadonlySet<string>;

  constructor(options: GoogleCoverValidatorOptions = {}) {
    this.fetchImage = options.fetchImage ?? ((input, init) => fetch(input, init));
    this.placeholderLengths = options.placeholderLengths ?? GOOGLE_BOOKS_PLACEHOLDER_LENGTHS;
    this.placeholderHashes = options.placeholderHashes ?? GOOGLE_BOOKS_PLACEHOLDER_HASHES;
  }

  async filterCandidates(candidates: MetadataCandidate[], signal?: AbortSignal): Promise<MetadataCandidate[]> {
    const output = [...candidates];
    const jobs = candidates
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => candidate.coverUrl && this.isGoogleBooksCoverUrl(candidate.coverUrl));
    let cursor = 0;

    const workers = Array.from({ length: Math.min(VALIDATION_CONCURRENCY, jobs.length) }, async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        if (!job?.candidate.coverUrl) continue;
        const usable = await this.isUsable(job.candidate.coverUrl, signal);
        if (usable === false) output[job.index] = { ...job.candidate, coverUrl: undefined };
      }
    });

    await Promise.all(workers);
    return output;
  }

  private isGoogleBooksCoverUrl(value: string): boolean {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === GOOGLE_BOOKS_COVER_HOST && url.pathname === '/books/content';
    } catch {
      return false;
    }
  }

  private async isUsable(url: string, parentSignal?: AbortSignal): Promise<boolean | null> {
    const cached = this.cache.get(url);
    if (cached && cached.expiresAt > Date.now()) return cached.usable;
    if (cached) this.cache.delete(url);

    try {
      const signal = buildRequestSignal(VALIDATION_TIMEOUT_MS, parentSignal);
      const head = await this.fetchImage(url, { method: 'HEAD', redirect: 'manual', signal });
      if (head.status === 404 || head.status === 410) return this.cacheResult(url, false);
      if (!head.ok) return null;

      const contentType = head.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
      const contentLength = Number(head.headers.get('content-length'));
      if (contentType !== 'image/png' || !this.placeholderLengths.has(contentLength)) return this.cacheResult(url, true);

      const response = await this.fetchImage(url, { redirect: 'manual', signal });
      if (response.status === 404 || response.status === 410) return this.cacheResult(url, false);
      if (!response.ok) return null;

      const bytes = await this.readBounded(response);
      if (!bytes) return null;
      const hash = createHash('sha256').update(bytes).digest('hex');
      return this.cacheResult(url, !this.placeholderHashes.has(hash));
    } catch (error) {
      if (parentSignal?.aborted) throw error;
      return null;
    }
  }

  private async readBounded(response: Response): Promise<Buffer | null> {
    if (!response.body) return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_FINGERPRINT_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }

    return Buffer.concat(chunks);
  }

  private cacheResult(url: string, usable: boolean): boolean {
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(url, { usable, expiresAt: Date.now() + CACHE_TTL_MS });
    return usable;
  }
}
