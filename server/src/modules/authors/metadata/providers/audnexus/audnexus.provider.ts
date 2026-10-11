import { Injectable, Logger } from '@nestjs/common';
import { AUTHOR_PROVIDER_SUPPORTED_FIELDS, AuthorMetadataCandidate, AuthorMetadataField, AuthorMetadataProviderKey } from '@bookorbit/types';

import { canonicalId, canonicalText } from '../../../../../common/provider-cache/canonicalize';
import { markProviderDegraded, markProviderFailed } from '../../../../../common/provider-cache/provider-call-context';
import type { ProviderCacheSpec } from '../../../../../common/provider-cache/provider-cache-spec';
import { authorProviderFetch, authorRequestSignal } from '../author-fetch';
import { AuthorMetadataProviderError, AuthorMetadataSearchParams, IdentifiableAuthorMetadataProvider } from '../author-metadata-provider';
import { authorProviderCacheContext, canonicalAuthorRegion } from '../author-provider-cache';
import { AudnexusAuthorResponse } from './audnexus.types';

const BASE_URL = 'https://api.audnex.us';
const REQUEST_TIMEOUT_MS = 12_000;

@Injectable()
export class AudnexusAuthorMetadataProvider implements IdentifiableAuthorMetadataProvider {
  readonly key = AuthorMetadataProviderKey.AUDNEXUS;
  readonly label = 'Audnexus';
  readonly identifiable = true as const;
  readonly supportedFields: readonly AuthorMetadataField[] = AUTHOR_PROVIDER_SUPPORTED_FIELDS[AuthorMetadataProviderKey.AUDNEXUS];

  private readonly logger = new Logger(AudnexusAuthorMetadataProvider.name);

  // Empty answers are trusted because every way Audnexus can fail (transport, status, malformed or
  // unexpected body, unmappable rows) leaves the call record uncacheable; see the provider tests.
  readonly cache: ProviderCacheSpec<AuthorMetadataSearchParams> = {
    version: 1,
    trustEmpty: true,
    context: () => Promise.resolve(authorProviderCacheContext(true)),
    describeSearch: (params) => {
      const name = canonicalText(params.name);
      if (!name) return null;
      return { inputs: { name, region: canonicalAuthorRegion(params.region) }, maxCandidates: this.normalizeLimit(params.limit) };
    },
    describeLookup: (providerId, params) => {
      const id = canonicalId(providerId);
      if (!id) return null;
      return { inputs: { id, region: canonicalAuthorRegion(params?.region) } };
    },
  };

  async search(params: AuthorMetadataSearchParams): Promise<AuthorMetadataCandidate[]> {
    const name = params.name?.trim();
    if (!name) return [];

    const region = canonicalAuthorRegion(params.region);
    const limit = this.normalizeLimit(params.limit);

    const body = await this.fetchJson(
      `${BASE_URL}/authors?${new URLSearchParams({
        name,
        region,
      }).toString()}`,
      params.signal,
    );
    if (!Array.isArray(body)) {
      markProviderFailed('audnexus_unexpected_search_body');
      return [];
    }
    const rows = body as AudnexusAuthorResponse[];
    if (!rows.length) return [];

    const seenProviderIds = new Set<string>();
    const candidates: AuthorMetadataCandidate[] = [];

    for (const row of rows) {
      const candidate = this.mapRow(row);
      if (!candidate) {
        markProviderDegraded('audnexus_unmapped_row');
        continue;
      }
      if (seenProviderIds.has(candidate.providerId)) continue;
      seenProviderIds.add(candidate.providerId);
      candidates.push(candidate);
      if (candidates.length >= limit) break;
    }

    return candidates;
  }

  async lookupById(providerId: string, region?: string, signal?: AbortSignal): Promise<AuthorMetadataCandidate | null> {
    const asin = providerId.trim();
    if (!asin) return null;

    const query = new URLSearchParams({
      region: canonicalAuthorRegion(region),
    }).toString();

    const row = await this.fetchJson<AudnexusAuthorResponse>(`${BASE_URL}/authors/${encodeURIComponent(asin)}?${query}`, signal);
    const candidate = this.mapRow(row);
    if (!candidate) markProviderFailed('audnexus_unexpected_lookup_body');
    return candidate;
  }

  private normalizeLimit(limit?: number): number {
    if (!Number.isFinite(limit)) return 10;
    const numeric = Number(limit);
    return Math.max(1, Math.min(25, Math.floor(numeric)));
  }

  private async fetchJson<T = unknown>(url: string, signal?: AbortSignal): Promise<T> {
    const startedAt = Date.now();
    this.logger.log(`[audnexus] [start] method=GET`);
    try {
      const res = await authorProviderFetch(url, { signal: authorRequestSignal(REQUEST_TIMEOUT_MS, signal) });
      if (!res.ok) {
        const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'));
        const message = `[audnexus] [fail] method=GET status=${res.status} durationMs=${Date.now() - startedAt} message="non-ok response"`;
        this.logger.warn(message);
        throw new AuthorMetadataProviderError(message, {
          httpStatus: res.status,
          retryAfterMs,
          transient: res.status === 429 || res.status >= 500,
        });
      }
      let body: T;
      try {
        body = (await res.json()) as T;
      } catch (error) {
        markProviderFailed('audnexus_malformed_json');
        throw error;
      }
      this.logger.log(`[audnexus] [end] method=GET status=${res.status} durationMs=${Date.now() - startedAt}`);
      return body;
    } catch (error) {
      if (error instanceof AuthorMetadataProviderError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`[audnexus] [fail] method=GET durationMs=${Date.now() - startedAt} message="${message}"`);
      throw new AuthorMetadataProviderError(`[audnexus] [fail] method=GET durationMs=${Date.now() - startedAt} message="${message}"`, {
        transient: true,
      });
    }
  }

  /** A mapping error marks the answer as failed before it propagates, so it can never be cached. */
  private mapRow(input: AudnexusAuthorResponse | null | undefined): AuthorMetadataCandidate | null {
    try {
      return this.toCandidate(input);
    } catch (error) {
      markProviderFailed('audnexus_mapper_error');
      throw error;
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
