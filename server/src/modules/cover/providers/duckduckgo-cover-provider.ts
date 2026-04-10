import { Injectable, Logger } from '@nestjs/common';
import { CoverSearchResult } from '@projectx/types';
import { COVER_PROXY_USER_AGENT } from '../constants';
import { CoverProvider, CoverSearchParams, DUCKDUCKGO_PROVIDER_KEY } from './cover-provider';

@Injectable()
export class DuckDuckGoCoverProvider implements CoverProvider {
  private readonly logger = new Logger(DuckDuckGoCoverProvider.name);
  readonly key = DUCKDUCKGO_PROVIDER_KEY;

  private static readonly SEARCH_BASE_URL = 'https://duckduckgo.com/?q=';
  private static readonly JSON_BASE_URL = 'https://duckduckgo.com/i.js?o=json&q=';
  private static readonly SEARCH_PARAMS_TALL = '&iar=images&iaf=size%3ALarge%2Clayout%3ATall';
  private static readonly SEARCH_PARAMS_SQUARE = '&iar=images&iaf=size%3ALarge%2Clayout%3ASquare';

  async search(params: CoverSearchParams): Promise<CoverSearchResult[]> {
    const { title, author, isAudiobook } = params;
    const bookType = isAudiobook ? 'audiobook' : 'book';
    const searchTerm = author ? `${title} ${author} ${bookType}` : `${title} ${bookType}`;

    const searchParams = isAudiobook ? DuckDuckGoCoverProvider.SEARCH_PARAMS_SQUARE : DuckDuckGoCoverProvider.SEARCH_PARAMS_TALL;

    try {
      // 1. Specific search (Amazon/Goodreads)
      const siteFilteredResults = await this.performSearch(`${searchTerm} (site:amazon.com OR site:goodreads.com)`, searchParams);

      // 2. General search
      const generalResults = await this.performSearch(searchTerm, searchParams);

      // Filter and merge
      const filteredSiteResults = this.filterResults(siteFilteredResults, isAudiobook).slice(0, 10);
      const filteredGeneralResults = this.filterResults(generalResults, isAudiobook);

      const seenUrls = new Set(filteredSiteResults.map((r) => r.sourceUrl));
      const combined = [...filteredSiteResults];

      for (const res of filteredGeneralResults) {
        if (!seenUrls.has(res.sourceUrl)) {
          combined.push(res);
          seenUrls.add(res.sourceUrl);
          if (combined.length >= 25) break;
        }
      }

      // Fallback: If few results, try broader search (title only)
      if (combined.length < 5 && author) {
        const fallbackResults = await this.performSearch(`${title} ${bookType}`, searchParams);
        const filteredFallback = this.filterResults(fallbackResults, isAudiobook);
        for (const res of filteredFallback) {
          if (!seenUrls.has(res.sourceUrl)) {
            combined.push(res);
            seenUrls.add(res.sourceUrl);
            if (combined.length >= 25) break;
          }
        }
      }

      return combined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Error searching DuckDuckGo: ${message}`, stack);
      return [];
    }
  }

  private async performSearch(query: string, searchParams: string): Promise<CoverSearchResult[]> {
    const searchUrl = `${DuckDuckGoCoverProvider.SEARCH_BASE_URL}${encodeURIComponent(query)}${searchParams}`;

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': COVER_PROXY_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!response.ok) {
      this.logger.warn(`Search page fetch failed: ${response.status}`);
      return [];
    }

    const html = await response.text();
    const vqdMatch = html.match(/vqd="(\d+-\d+)"/);
    if (!vqdMatch) {
      this.logger.warn('Could not find vqd token');
      return [];
    }
    const vqd = vqdMatch[1];

    const apiUrl = `${DuckDuckGoCoverProvider.JSON_BASE_URL}${encodeURIComponent(query)}${searchParams}&vqd=${vqd}`;
    const apiResponse = await fetch(apiUrl, {
      headers: {
        'User-Agent': COVER_PROXY_USER_AGENT,
        Accept: 'application/json, text/javascript, */*; q=0.01',
        Referer: searchUrl,
        'x-vqd-4': vqd,
      },
    });

    if (!apiResponse.ok) {
      this.logger.warn(`API fetch failed: ${apiResponse.status}`);
      return [];
    }

    const data = (await apiResponse.json()) as any;
    const results: any[] = data.results || [];

    return results.map((r) => ({
      previewUrl: r.thumbnail,
      sourceUrl: r.image,
      width: r.width,
      height: r.height,
      source: this.determineSource(r.image),
      url: r.image, // Will be proxied in the controller
    }));
  }

  private filterResults(results: CoverSearchResult[], isAudiobook: boolean | undefined): CoverSearchResult[] {
    return results.filter((r) => {
      if (r.width < 350) return false;
      if (isAudiobook) {
        const ratio = r.width / r.height;
        return ratio >= 0.85 && ratio <= 1.15;
      } else {
        return r.width < r.height;
      }
    });
  }

  private determineSource(url: string): string {
    if (url.includes('amazon.com')) return 'Amazon';
    if (url.includes('goodreads.com')) return 'Goodreads';
    if (url.includes('google.com')) return 'Google';
    try {
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return 'Web';
    }
  }
}
