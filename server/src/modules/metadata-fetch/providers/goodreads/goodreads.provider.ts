import { Injectable, Logger } from '@nestjs/common';
import { MetadataCandidate, MetadataProviderKey } from '@projectx/types';

import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { fetchWithThrottle } from '../../fetch-with-throttle';
import { ProviderThrottleError } from '../../provider-throttle.error';
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

  constructor(private readonly providerConfig: ProviderConfigService) {}

  async search(params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    const { enabled } = await this.providerConfig.getConfig().then((c) => c.goodreads);
    if (!enabled) return [];
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
    const { enabled } = await this.providerConfig.getConfig().then((c) => c.goodreads);
    if (!enabled) return null;
    return this.fetchBook(providerId);
  }

  private async searchIds(params: MetadataSearchParams): Promise<string[]> {
    const query = [params.title, params.author].filter(Boolean).join(' ');
    const url = `https://www.goodreads.com/search?q=${encodeURIComponent(query)}&search_type=books`;
    const html = await this.fetchHtml(url, 'search', query);
    return html ? extractBookIds(html, params.title, MAX_RESULTS) : [];
  }

  private async findIdByIsbn(isbn: string): Promise<string | null> {
    const html = await this.fetchHtml(`https://www.goodreads.com/book/isbn/${isbn}`, 'search-by-isbn', isbn);
    if (!html) return null;
    return (
      html.match(/property="og:url"\s+content="[^"]*\/book\/show\/(\d+)/)?.[1] ??
      html.match(/<link[^>]+rel="canonical"[^>]+href="[^"]*\/book\/show\/(\d+)/)?.[1] ??
      null
    );
  }

  private async fetchBook(bookId: string): Promise<MetadataCandidate | null> {
    const url = `https://www.goodreads.com/book/show/${bookId}`;
    const html = await this.fetchHtml(url, 'lookup', undefined, bookId);
    if (!html) return null;
    const nextData = extractNextData(html);
    const state = nextData?.props?.pageProps?.apolloState;
    if (!state) return null;
    return mapGoodreadsApolloState(state, bookId);
  }

  private async fetchHtml(url: string, op: 'search' | 'search-by-isbn' | 'lookup', query?: string, providerId?: string): Promise<string | null> {
    const startedAt = Date.now();
    this.logger.log(`[goodreads] fetch.start op=${op}${query ? ` query="${query}"` : ''}${providerId ? ` providerId="${providerId}"` : ''}`);
    try {
      const res = await fetchWithThrottle(url, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        this.logger.warn(
          `[goodreads] fetch.fail op=${op}${query ? ` query="${query}"` : ''}${providerId ? ` providerId="${providerId}"` : ''} status=${res.status} durationMs=${Date.now() - startedAt} message="non-ok response"`,
        );
        return null;
      }
      const html = await res.text();
      this.logger.log(
        `[goodreads] fetch.end op=${op}${query ? ` query="${query}"` : ''}${providerId ? ` providerId="${providerId}"` : ''} status=${res.status} durationMs=${Date.now() - startedAt}`,
      );
      return html;
    } catch (err) {
      if (err instanceof ProviderThrottleError) {
        this.logger.warn(
          `[goodreads] fetch.fail op=${op}${query ? ` query="${query}"` : ''}${providerId ? ` providerId="${providerId}"` : ''} durationMs=${Date.now() - startedAt} message="throttled"`,
        );
        throw err;
      }
      this.logger.warn(
        `[goodreads] fetch.fail op=${op}${query ? ` query="${query}"` : ''}${providerId ? ` providerId="${providerId}"` : ''} durationMs=${Date.now() - startedAt} message="${err instanceof Error ? err.message : String(err)}"`,
      );
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

function extractBookIds(html: string, titleHint: string | undefined, limit: number): string[] {
  const seen = new Set<string>();
  const entries: Array<{ id: string; slug: string }> = [];

  // from_srp=true only appears on actual search result links, not nav/sidebar
  const pattern = /href="(\/book\/show\/[^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(html)) !== null) {
    const href = m[1];
    if (!href.includes('from_srp=true')) continue;
    const idMatch = /\/book\/show\/(\d+)([^?]*)/.exec(href);
    if (!idMatch) continue;
    const id = idMatch[1];
    if (seen.has(id)) continue;
    seen.add(id);
    entries.push({ id, slug: idMatch[2] ?? '' });
  }

  if (!titleHint || entries.length <= limit) {
    return entries.slice(0, limit).map((e) => e.id);
  }

  // Score entries by how many title words appear in the URL slug so that
  // companion books and study guides (with unrelated slugs) rank below actual matches.
  const titleWords = titleHint
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2);
  const scored = entries.map((e) => ({
    id: e.id,
    score: titleWords.filter((w) => e.slug.toLowerCase().includes(w)).length,
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.id);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
