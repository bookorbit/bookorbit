import { Injectable, Logger } from '@nestjs/common';
import { AUTHOR_PROVIDER_SUPPORTED_FIELDS, AuthorMetadataCandidate, AuthorMetadataField, AuthorMetadataProviderKey } from '@bookorbit/types';

import { sanitizeLogValue } from '../../../../../common/utils/log-sanitize.utils';
import { ProviderConfigService } from '../../../../metadata-preferences/provider-config.service';
import { AuthorMetadataProviderError, AuthorMetadataSearchParams, IdentifiableAuthorMetadataProvider } from '../author-metadata-provider';
import { authorRefsFromAutocomplete, parseGoodreadsAuthorPage, parseGoodreadsAuthorSearch } from './goodreads-author.scraper';
import { GoodreadsAuthorAutocompleteItem, GoodreadsAuthorRef } from './goodreads.types';

const BASE_URL = 'https://www.goodreads.com';
const REQUEST_TIMEOUT_MS = 15_000;
const BETWEEN_REQUESTS_MS = 600;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

const HTML_HEADERS: HeadersInit = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};

const JSON_HEADERS: HeadersInit = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  accept: 'application/json,text/plain,*/*',
  'accept-language': 'en-US,en;q=0.9',
};

type FetchOp = 'autocomplete' | 'search' | 'lookup';

@Injectable()
export class GoodreadsAuthorMetadataProvider implements IdentifiableAuthorMetadataProvider {
  readonly key = AuthorMetadataProviderKey.GOODREADS;
  readonly label = 'Goodreads';
  readonly identifiable = true as const;
  readonly supportedFields: readonly AuthorMetadataField[] = AUTHOR_PROVIDER_SUPPORTED_FIELDS[AuthorMetadataProviderKey.GOODREADS];

  private readonly logger = new Logger(GoodreadsAuthorMetadataProvider.name);

  constructor(private readonly providerConfig: ProviderConfigService) {}

  async search(params: AuthorMetadataSearchParams): Promise<AuthorMetadataCandidate[]> {
    if (!(await this.isEnabled())) return [];

    const name = params.name?.trim();
    if (!name) return [];

    const limit = this.normalizeLimit(params.limit);

    // The autocomplete endpoint answers with JSON and is not WAF-gated, so it
    // resolves most names without touching a rendered page. Authors whose name
    // does not surface in book autocomplete (or differs by a middle initial)
    // still need the heavier search page.
    let refs = authorRefsFromAutocomplete(await this.fetchAutocomplete(name));
    if (refs.length === 0) {
      await this.sleep(BETWEEN_REQUESTS_MS);
      refs = parseGoodreadsAuthorSearch(await this.fetchSearchPage(name));
    }

    return refs.slice(0, limit).map((ref) => this.toShallowCandidate(ref));
  }

  async lookupById(providerId: string): Promise<AuthorMetadataCandidate | null> {
    if (!(await this.isEnabled())) return null;

    const id = providerId.trim();
    if (!id) return null;

    const html = await this.fetchText(`${BASE_URL}/author/show/${encodeURIComponent(id)}`, 'lookup', HTML_HEADERS);
    const parsed = parseGoodreadsAuthorPage(html ?? '');
    if (!parsed) return null;

    return {
      provider: this.key,
      providerId: id,
      name: parsed.name,
      description: parsed.description,
      imageUrl: parsed.imageUrl,
      sourceUrl: `${BASE_URL}/author/show/${id}`,
      birthDate: parsed.birthDate,
      birthYear: parsed.birthYear,
      deathDate: parsed.deathDate,
      deathYear: parsed.deathYear,
      website: parsed.website,
      genres: parsed.genres,
      influences: parsed.influences,
    };
  }

  private toShallowCandidate(ref: GoodreadsAuthorRef): AuthorMetadataCandidate {
    return {
      provider: this.key,
      providerId: ref.providerId,
      name: ref.name,
      sourceUrl: `${BASE_URL}/author/show/${ref.providerId}`,
    };
  }

  private async isEnabled(): Promise<boolean> {
    const config = await this.providerConfig.getConfig();
    return config.goodreads.enabled;
  }

  private async fetchAutocomplete(name: string): Promise<GoodreadsAuthorAutocompleteItem[]> {
    const url = `${BASE_URL}/book/auto_complete?${new URLSearchParams({ format: 'json', q: name }).toString()}`;
    const body = await this.fetchText(url, 'autocomplete', JSON_HEADERS);
    if (!body) return [];
    try {
      const parsed: unknown = JSON.parse(body);
      return Array.isArray(parsed) ? (parsed as GoodreadsAuthorAutocompleteItem[]) : [];
    } catch {
      return [];
    }
  }

  private async fetchSearchPage(name: string): Promise<string> {
    const query = new URLSearchParams({ q: name, 'search[field]': 'author' }).toString();
    return (await this.fetchText(`${BASE_URL}/search?${query}`, 'search', HTML_HEADERS)) ?? '';
  }

  private async fetchText(url: string, op: FetchOp, headers: HeadersInit): Promise<string | null> {
    const startedAt = Date.now();
    this.logger.log(`[goodreads_author] [start] op=${op} method=GET`);
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!res.ok) {
        const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'));
        const message = `[goodreads_author] [fail] op=${op} method=GET status=${res.status} durationMs=${Date.now() - startedAt} message="non-ok response"`;
        this.logger.warn(message);
        throw new AuthorMetadataProviderError(message, {
          httpStatus: res.status,
          retryAfterMs,
          transient: res.status === 429 || res.status >= 500,
        });
      }
      const body = await res.text();
      this.logger.log(`[goodreads_author] [end] op=${op} method=GET status=${res.status} durationMs=${Date.now() - startedAt}`);
      return body;
    } catch (error) {
      if (error instanceof AuthorMetadataProviderError) throw error;
      const rawMessage = error instanceof Error ? error.message : 'unknown error';
      const message = `[goodreads_author] [fail] op=${op} method=GET durationMs=${Date.now() - startedAt} error="${sanitizeLogValue(rawMessage)}"`;
      this.logger.warn(message);
      throw new AuthorMetadataProviderError(message, { transient: true });
    }
  }

  private normalizeLimit(limit?: number): number {
    if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
    return Math.max(1, Math.min(MAX_LIMIT, Math.floor(Number(limit))));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;

  const dateMs = new Date(value).getTime();
  if (!Number.isFinite(dateMs)) return null;
  const delta = dateMs - Date.now();
  return delta > 0 ? delta : null;
}
