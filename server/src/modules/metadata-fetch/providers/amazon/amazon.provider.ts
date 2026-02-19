import { Injectable, Logger } from '@nestjs/common';
import { MetadataCandidate, MetadataProviderKey } from '@projectx/types';

import { IdentifiableProvider } from '../metadata-provider';
import { MetadataSearchParams } from '../metadata-search-params';
import { extractAsins, parseBookPage } from './amazon.scraper';

const HEADERS: HeadersInit = {
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'sec-ch-ua': '"Google Chrome";v="137", "Chromium";v="137", "Not_A Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
};

const MAX_RESULTS = 3;
const BETWEEN_REQUESTS_MS = 800;

@Injectable()
export class AmazonProvider implements IdentifiableProvider {
  readonly key = MetadataProviderKey.AMAZON;
  readonly label = 'Amazon';
  readonly identifiable = true as const;

  private readonly logger = new Logger(AmazonProvider.name);

  async search(params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    const asins = params.isbn
      ? [params.isbn] // try ASIN directly if ISBN provided
      : await this.searchAsins(params);

    const results: MetadataCandidate[] = [];
    for (const asin of asins.slice(0, MAX_RESULTS)) {
      if (results.length > 0) await sleep(BETWEEN_REQUESTS_MS);
      const candidate = await this.fetchByAsin(asin);
      if (candidate) results.push(candidate);
    }
    return results;
  }

  async lookupById(providerId: string): Promise<MetadataCandidate | null> {
    return this.fetchByAsin(providerId);
  }

  private async searchAsins(params: MetadataSearchParams): Promise<string[]> {
    const query = [params.title, params.author].filter(Boolean).join(' ');
    const url = `https://www.amazon.com/s?k=${encodeURIComponent(query)}&i=stripbooks`;
    const html = await this.fetchHtml(url);
    return html ? extractAsins(html, MAX_RESULTS) : [];
  }

  private async fetchByAsin(asin: string): Promise<MetadataCandidate | null> {
    const html = await this.fetchHtml(`https://www.amazon.com/dp/${asin}`);
    if (!html) return null;
    const data = parseBookPage(html);
    if (!data.title) return null;
    return {
      provider: MetadataProviderKey.AMAZON,
      providerId: asin,
      title: data.title,
      subtitle: data.subtitle,
      authors: data.authors?.length ? data.authors : undefined,
      description: data.description,
      isbn13: data.isbn13,
      isbn10: data.isbn10,
      publisher: data.publisher,
      publishedYear: data.publishedYear,
      language: data.language,
      pageCount: data.pageCount,
      seriesName: data.seriesName,
      seriesIndex: data.seriesIndex,
      coverUrl: data.coverUrl,
      tags: data.tags?.length ? data.tags : undefined,
      sourceUrl: `https://www.amazon.com/dp/${asin}`,
    };
  }

  private async fetchHtml(url: string): Promise<string | null> {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) {
        this.logger.warn(`Amazon returned ${res.status} for ${url}`);
        return null;
      }
      return res.text();
    } catch (err) {
      this.logger.warn(`Amazon fetch failed for ${url}: ${err}`);
      return null;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
