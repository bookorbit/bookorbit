import { Injectable, Logger } from '@nestjs/common';
import { AuthorMetadataCandidate, AuthorMetadataProviderKey } from '@projectx/types';

import { AuthorMetadataProviderError, AuthorMetadataSearchParams, IdentifiableAuthorMetadataProvider } from '../author-metadata-provider';
import { AudnexusAuthorResponse } from './audnexus.types';

const BASE_URL = 'https://api.audnex.us';
const DEFAULT_REGION = 'us';
const REQUEST_TIMEOUT_MS = 12_000;

@Injectable()
export class AudnexusAuthorMetadataProvider implements IdentifiableAuthorMetadataProvider {
  readonly key = AuthorMetadataProviderKey.AUDNEXUS;
  readonly label = 'Audnexus';
  readonly identifiable = true as const;

  private readonly logger = new Logger(AudnexusAuthorMetadataProvider.name);

  async search(params: AuthorMetadataSearchParams): Promise<AuthorMetadataCandidate[]> {
    const name = params.name?.trim();
    if (!name) return [];

    const region = params.region?.trim() || DEFAULT_REGION;
    const limit = this.normalizeLimit(params.limit);

    const rows = await this.fetchJson<AudnexusAuthorResponse[]>(
      `${BASE_URL}/authors?${new URLSearchParams({
        name,
        region,
      }).toString()}`,
    );
    if (!rows?.length) return [];

    const seenProviderIds = new Set<string>();
    const candidates: AuthorMetadataCandidate[] = [];

    for (const row of rows) {
      const candidate = this.toCandidate(row);
      if (!candidate) continue;
      if (seenProviderIds.has(candidate.providerId)) continue;
      seenProviderIds.add(candidate.providerId);
      candidates.push(candidate);
      if (candidates.length >= limit) break;
    }

    return candidates;
  }

  async lookupById(providerId: string, region?: string): Promise<AuthorMetadataCandidate | null> {
    const asin = providerId.trim();
    if (!asin) return null;

    const query = new URLSearchParams({
      region: region?.trim() || DEFAULT_REGION,
    }).toString();

    const row = await this.fetchJson<AudnexusAuthorResponse>(`${BASE_URL}/authors/${encodeURIComponent(asin)}?${query}`);
    return this.toCandidate(row);
  }

  private normalizeLimit(limit?: number): number {
    if (!Number.isFinite(limit)) return 10;
    const numeric = Number(limit);
    return Math.max(1, Math.min(25, Math.floor(numeric)));
  }

  private async fetchJson<T>(url: string): Promise<T | null> {
    const startedAt = Date.now();
    this.logger.log(`[audnexus] fetch.start method=GET`);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!res.ok) {
        const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'));
        const message = `[audnexus] fetch.fail method=GET status=${res.status} durationMs=${Date.now() - startedAt} message="non-ok response"`;
        this.logger.warn(message);
        throw new AuthorMetadataProviderError(message, {
          httpStatus: res.status,
          retryAfterMs,
          transient: res.status === 429 || res.status >= 500,
        });
      }
      const body = (await res.json()) as T;
      this.logger.log(`[audnexus] fetch.end method=GET status=${res.status} durationMs=${Date.now() - startedAt}`);
      return body;
    } catch (error) {
      if (error instanceof AuthorMetadataProviderError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`[audnexus] fetch.fail method=GET durationMs=${Date.now() - startedAt} message="${message}"`);
      throw new AuthorMetadataProviderError(`[audnexus] fetch.fail method=GET durationMs=${Date.now() - startedAt} message="${message}"`, {
        transient: true,
      });
    }
  }

  private toCandidate(input: AudnexusAuthorResponse | null | undefined): AuthorMetadataCandidate | null {
    if (!input) return null;

    const providerId = input.asin?.trim() ?? '';
    const name = input.name?.trim() ?? '';
    if (!providerId || !name) return null;

    const description = normalizeText(input.description);
    const imageUrl = normalizeUrl(input.image);

    return {
      provider: this.key,
      providerId,
      name,
      description: description || undefined,
      imageUrl: imageUrl || undefined,
      sourceUrl: `https://www.audible.com/author/${providerId}`,
    };
  }
}

function normalizeText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeUrl(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return '';
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  const dateMs = new Date(value).getTime();
  if (!Number.isFinite(dateMs)) return null;
  const delta = dateMs - Date.now();
  return delta > 0 ? delta : null;
}
