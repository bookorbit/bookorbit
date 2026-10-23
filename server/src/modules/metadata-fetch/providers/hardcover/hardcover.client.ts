import { Injectable, Logger } from '@nestjs/common';

import { markProviderDegraded, markProviderFailed } from '../../../../common/provider-cache/provider-call-context';
import { toBearerAuthorization } from '../../../../common/utils/bearer-token.utils';
import { fetchWithThrottle } from '../../fetch-with-throttle';
import { ProviderThrottleError } from '../../provider-throttle.error';
import { PROVIDER_DELAYS_MS, PROVIDER_LIMITS, PROVIDER_TIMEOUT_MS } from '../provider-constants';
import { buildRequestSignal, sanitizeLogError, sleep } from '../provider-utils';
import { HardcoverBookWithEditions, HardcoverBooksResponse, HardcoverSearchDocument, HardcoverSearchResponse } from './hardcover.types';

const GRAPHQL_ENDPOINT = 'https://api.hardcover.app/v1/graphql';

// The series total feeds the series gap finder, which reads it as the last book number, so it
// must be a released main-series number. books_count also counts novellas, split editions, box
// sets and announced books. Translations carry their own odd numbering, so only canonical books
// are considered.
const SERIES_FIELDS = `
  name
  primary_books_count
  latest_released: book_series(
    where: {
      position: { _is_null: false }
      compilation: { _eq: false }
      book: { canonical_id: { _is_null: true }, release_date: { _lte: $releasedBy } }
    }
    order_by: { position: desc }
    limit: 1
  ) { position }
`;

const BOOK_FIELDS = `
  id
  slug
  title
  subtitle
  description
  cached_contributors
  cached_tags
  featured_book_series { series { ${SERIES_FIELDS} } position }
  rating
  ratings_count
  pages
  release_date
  release_year
  image { url width height }
`;

const EDITION_FIELDS = `
  id
  title
  subtitle
  cached_contributors
  pages
  release_date
  release_year
  image { url width height }
  publisher { name }
  isbn_10
  isbn_13
  language { code2 }
  reading_format_id
  audio_seconds
`;

// Fetch several editions on slug lookup so the mapper can rank by format
// instead of resolving to whatever single edition Hardcover returns first.
const EDITION_LOOKUP_LIMIT = 50;

const SEARCH_BY_ISBN_QUERY = `
  query BookSearchByIsbn($isbn: String!, $releasedBy: date!) {
    books(where: { editions: { _or: [{ isbn_13: { _eq: $isbn } }, { isbn_10: { _eq: $isbn } }] } }) {
      ${BOOK_FIELDS}
      editions(where: { _or: [{ isbn_13: { _eq: $isbn } }, { isbn_10: { _eq: $isbn } }] }) {
        ${EDITION_FIELDS}
      }
    }
  }
`;

const SEARCH_BOOKS_QUERY = `
  query BookSearch($q: String!, $limit: Int!) {
    search(query: $q, query_type: "Book", per_page: $limit, page: 1) {
      results
    }
  }
`;

// The default book search also matches titles, which ranks books about an author (quiz books,
// companions, diaries) above the ones they wrote. Each field searched needs its own weight and typo
// allowance, or the search answers with an error instead of hits.
const SEARCH_BOOKS_BY_AUTHOR_QUERY = `
  query BookSearchByAuthor($q: String!, $limit: Int!) {
    search(query: $q, query_type: "Book", per_page: $limit, page: 1, fields: "author_names", weights: "1", typos: "1") {
      results
    }
  }
`;

const LOOKUP_BY_SLUG_QUERY = `
  query BookBySlug($slug: String!, $releasedBy: date!) {
    books(where: { slug: { _eq: $slug } }) {
      ${BOOK_FIELDS}
      editions(limit: ${EDITION_LOOKUP_LIMIT}) {
        ${EDITION_FIELDS}
      }
    }
  }
`;

class RateLimiter {
  private nextAllowedTime = 0;

  async throttle(signal?: AbortSignal): Promise<void> {
    const now = Date.now();
    const scheduled = Math.max(now, this.nextAllowedTime);
    this.nextAllowedTime = scheduled + PROVIDER_DELAYS_MS.HARDCOVER_RATE_LIMIT;
    const wait = scheduled - now;
    if (wait > 0) {
      await sleep(wait, signal);
    }
  }
}

// Deliberately not part of the provider cache key, which would expire every answer at midnight. A
// cached answer from before a release can only undercount, and stored series totals only rise.
function releasedBy(): string {
  return new Date().toISOString().slice(0, 10);
}

// GraphQL reports query and permission faults in a 200 body, sometimes alongside partial data.
function reportGraphqlBodyQuality(body: unknown, op: string): void {
  const record = typeof body === 'object' && body !== null ? (body as { errors?: unknown; data?: unknown }) : null;
  if (!record || record.errors !== undefined || record.data === undefined || record.data === null) {
    markProviderFailed(`hardcover.${op}: graphql error body`);
  }
}

@Injectable()
export class HardcoverClient {
  private readonly logger = new Logger(HardcoverClient.name);
  private readonly rateLimiter = new RateLimiter();

  async searchByIsbn(isbn: string, apiKey: string, signal?: AbortSignal): Promise<HardcoverBookWithEditions[]> {
    const body = await this.post<HardcoverBooksResponse>('search-by-isbn', SEARCH_BY_ISBN_QUERY, { isbn, releasedBy: releasedBy() }, apiKey, signal);
    if (body && !Array.isArray(body.data?.books)) markProviderFailed('hardcover.search-by-isbn: response without books');
    return body?.data?.books ?? [];
  }

  async searchBooks(
    query: string,
    apiKey: string,
    signal?: AbortSignal,
    limit: number = PROVIDER_LIMITS.DEFAULT_SEARCH_RESULTS,
  ): Promise<HardcoverSearchDocument[]> {
    return this.search('search', SEARCH_BOOKS_QUERY, query, apiKey, signal, limit);
  }

  /** The books an author wrote, most read first. */
  async searchBooksByAuthor(
    author: string,
    apiKey: string,
    signal?: AbortSignal,
    limit: number = PROVIDER_LIMITS.DEFAULT_SEARCH_RESULTS,
  ): Promise<HardcoverSearchDocument[]> {
    return this.search('search-by-author', SEARCH_BOOKS_BY_AUTHOR_QUERY, author, apiKey, signal, limit);
  }

  async lookupBySlug(slug: string, apiKey: string, signal?: AbortSignal): Promise<HardcoverBookWithEditions | null> {
    const body = await this.post<HardcoverBooksResponse>('lookup', LOOKUP_BY_SLUG_QUERY, { slug, releasedBy: releasedBy() }, apiKey, signal);
    if (body && !Array.isArray(body.data?.books)) markProviderFailed('hardcover.lookup: response without books');
    return body?.data?.books?.[0] ?? null;
  }

  private async search(
    op: 'search' | 'search-by-author',
    graphql: string,
    query: string,
    apiKey: string,
    signal: AbortSignal | undefined,
    limit: number,
  ): Promise<HardcoverSearchDocument[]> {
    const body = await this.post<HardcoverSearchResponse>(op, graphql, { q: query, limit }, apiKey, signal);
    const hits = body?.data?.search?.results?.hits;
    if (body && !Array.isArray(hits)) markProviderFailed(`hardcover.${op}: response without hits`);
    const documents = hits?.map((h) => h.document).filter((d): d is HardcoverSearchDocument => d != null) ?? [];
    if (hits && documents.length < hits.length) markProviderDegraded(`hardcover.${op}: hit without document`);
    return documents;
  }

  private async post<T>(
    op: 'search-by-isbn' | 'search' | 'search-by-author' | 'lookup',
    query: string,
    variables: Record<string, unknown>,
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<T | null> {
    await this.rateLimiter.throttle(signal);
    const startedAt = Date.now();
    this.logger.log(`[hardcover] [start] op=${op} method=POST`);

    try {
      const res = await fetchWithThrottle(GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: toBearerAuthorization(apiKey),
        },
        body: JSON.stringify({ query, variables }),
        signal: buildRequestSignal(PROVIDER_TIMEOUT_MS.DEFAULT, signal),
      });

      if (!res.ok) {
        this.logger.warn(
          `[hardcover] [fail] op=${op} method=POST status=${res.status} durationMs=${Date.now() - startedAt} message="non-ok response"`,
        );
        return null;
      }

      const body = (await res.json()) as T;
      reportGraphqlBodyQuality(body, op);
      this.logger.log(`[hardcover] [end] op=${op} method=POST status=${res.status} durationMs=${Date.now() - startedAt}`);
      return body;
    } catch (err) {
      if (err instanceof ProviderThrottleError) {
        this.logger.warn(`[hardcover] [fail] op=${op} method=POST durationMs=${Date.now() - startedAt} message="throttled"`);
        throw err;
      }
      markProviderFailed(`hardcover.${op}: unusable response`);
      this.logger.warn(`[hardcover] [fail] op=${op} method=POST durationMs=${Date.now() - startedAt} message="${sanitizeLogError(err)}"`);
      return null;
    }
  }
}
