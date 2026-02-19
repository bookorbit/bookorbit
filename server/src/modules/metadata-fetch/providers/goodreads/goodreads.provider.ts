import { Injectable, Logger } from '@nestjs/common';
import { MetadataCandidate, MetadataProviderKey } from '@projectx/types';

import { IdentifiableProvider } from '../metadata-provider';
import { MetadataSearchParams } from '../metadata-search-params';
import { mapGoodreadsApolloState } from './goodreads.mapper';
import { GoodreadsNextData } from './goodreads.types';

const HEADERS: HeadersInit = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};

const MAX_RESULTS = 3;
const BETWEEN_REQUESTS_MS = 600;

@Injectable()
export class GoodreadsProvider implements IdentifiableProvider {
  readonly key = MetadataProviderKey.GOODREADS;
  readonly label = 'Goodreads';
  readonly identifiable = true as const;

  private readonly logger = new Logger(GoodreadsProvider.name);

  async search(params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    const ids = params.isbn ? await this.findIdByIsbn(params.isbn).then((id) => (id ? [id] : [])) : await this.searchIds(params);

    const results: MetadataCandidate[] = [];
    for (const id of ids.slice(0, MAX_RESULTS)) {
      if (results.length > 0) await sleep(BETWEEN_REQUESTS_MS);
      const candidate = await this.fetchBook(id);
      if (candidate) results.push(candidate);
    }
    return results;
  }

  async lookupById(providerId: string): Promise<MetadataCandidate | null> {
    return this.fetchBook(providerId);
  }

  private async searchIds(params: MetadataSearchParams): Promise<string[]> {
    const query = [params.title, params.author].filter(Boolean).join(' ');
    const url = `https://www.goodreads.com/search?q=${encodeURIComponent(query)}&search_type=books`;
    const html = await this.fetchHtml(url);
    return html ? extractBookIds(html, MAX_RESULTS) : [];
  }

  private async findIdByIsbn(isbn: string): Promise<string | null> {
    const html = await this.fetchHtml(`https://www.goodreads.com/book/isbn/${isbn}`);
    if (!html) return null;
    return (
      html.match(/property="og:url"\s+content="[^"]*\/book\/show\/(\d+)/)?.[1] ??
      html.match(/<link[^>]+rel="canonical"[^>]+href="[^"]*\/book\/show\/(\d+)/)?.[1] ??
      null
    );
  }

  private async fetchBook(bookId: string): Promise<MetadataCandidate | null> {
    const html = await this.fetchHtml(`https://www.goodreads.com/book/show/${bookId}`);
    if (!html) return null;
    const nextData = extractNextData(html);
    const state = nextData?.props?.pageProps?.apolloState;
    if (!state) return null;
    return mapGoodreadsApolloState(state, bookId);
  }

  private async fetchHtml(url: string): Promise<string | null> {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) {
        this.logger.warn(`Goodreads returned ${res.status} for ${url}`);
        return null;
      }
      return res.text();
    } catch (err) {
      this.logger.warn(`Goodreads fetch failed for ${url}: ${err}`);
      return null;
    }
  }
}

function extractNextData(html: string): GoodreadsNextData | null {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]) as GoodreadsNextData;
  } catch {
    return null;
  }
}

function extractBookIds(html: string, limit: number): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  let m: RegExpExecArray | null;
  const pattern = /href="\/book\/show\/(\d+)/g;
  while ((m = pattern.exec(html)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      ids.push(m[1]);
      if (ids.length >= limit) break;
    }
  }
  return ids;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
