import { Injectable, Logger } from '@nestjs/common';

import { fetchWithThrottle } from '../../fetch-with-throttle';
import { ProviderThrottleError } from '../../provider-throttle.error';
import { HardcoverBookWithEditions, HardcoverBooksResponse, HardcoverSearchDocument, HardcoverSearchResponse } from './hardcover.types';

const GRAPHQL_ENDPOINT = 'https://api.hardcover.app/v1/graphql';
const RATE_LIMIT_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_SEARCH_LIMIT = 10;

const BOOK_FIELDS = `
  id
  slug
  title
  subtitle
  description
  cached_contributors
  featured_book_series { series { name books_count } position }
  rating
  ratings_count
  pages
  release_date
  release_year
  image { url }
`;

const EDITION_FIELDS = `
  id
  title
  subtitle
  cached_contributors
  pages
  release_date
  release_year
  image { url }
  publisher { name }
  isbn_10
  isbn_13
  language { code2 }
`;

const SEARCH_BY_ISBN_QUERY = `
  query BookSearchByIsbn($isbn: String!) {
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

const LOOKUP_BY_SLUG_QUERY = `
  query BookBySlug($slug: String!) {
    books(where: { slug: { _eq: $slug } }) {
      ${BOOK_FIELDS}
      editions(limit: 1) {
        ${EDITION_FIELDS}
      }
    }
  }
`;

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
export class HardcoverClient {
  private readonly logger = new Logger(HardcoverClient.name);
  private readonly rateLimiter = new RateLimiter();

  async searchByIsbn(isbn: string, apiKey: string): Promise<HardcoverBookWithEditions[]> {
    const body = await this.post<HardcoverBooksResponse>('search-by-isbn', SEARCH_BY_ISBN_QUERY, { isbn }, apiKey);
    return body?.data?.books ?? [];
  }

  async searchBooks(query: string, apiKey: string): Promise<HardcoverSearchDocument[]> {
    const body = await this.post<HardcoverSearchResponse>('search', SEARCH_BOOKS_QUERY, { q: query, limit: DEFAULT_SEARCH_LIMIT }, apiKey);
    return body?.data?.search?.results?.hits?.map((h) => h.document).filter((d): d is HardcoverSearchDocument => d != null) ?? [];
  }

  async lookupBySlug(slug: string, apiKey: string): Promise<HardcoverBookWithEditions | null> {
    const body = await this.post<HardcoverBooksResponse>('lookup', LOOKUP_BY_SLUG_QUERY, { slug }, apiKey);
    return body?.data?.books?.[0] ?? null;
  }

  private async post<T>(
    op: 'search-by-isbn' | 'search' | 'lookup',
    query: string,
    variables: Record<string, unknown>,
    apiKey: string,
  ): Promise<T | null> {
    await this.rateLimiter.throttle();
    const startedAt = Date.now();
    this.logger.log(`[hardcover] fetch.start op=${op} method=POST`);

    try {
      const res = await fetchWithThrottle(GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: apiKey,
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!res.ok) {
        this.logger.warn(
          `[hardcover] fetch.fail op=${op} method=POST status=${res.status} durationMs=${Date.now() - startedAt} message="non-ok response"`,
        );
        return null;
      }

      const body = (await res.json()) as T;
      this.logger.log(`[hardcover] fetch.end op=${op} method=POST status=${res.status} durationMs=${Date.now() - startedAt}`);
      return body;
    } catch (err) {
      if (err instanceof ProviderThrottleError) {
        this.logger.warn(`[hardcover] fetch.fail op=${op} method=POST durationMs=${Date.now() - startedAt} message="throttled"`);
        throw err;
      }
      this.logger.warn(`[hardcover] fetch.fail op=${op} method=POST durationMs=${Date.now() - startedAt} message="${(err as Error).message}"`);
      return null;
    }
  }
}
