import { Injectable, Logger } from '@nestjs/common';
import { CoverSearchResult } from '@bookorbit/types';

import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { COVER_PROXY_USER_AGENT } from '../constants';
import { AUDIOBOOKCOVERS_PROVIDER_KEY, CoverProvider, CoverSearchParams } from './cover-provider';

// AudiobookCovers.com renders search results server-side and embeds them as a serialized
// object graph in the page (no public JSON API), so we scrape the id + jpeg URLs out of the HTML.
const RESULT_PATTERN = /id:"([0-9a-fA-F-]{36})".*?jpeg:\$R\[\d+\]=\{320:"([^"]+)",640:"([^"]+)",1280:"([^"]+)"\}/gs;
const COVER_SIZE = 1280;
const MAX_RESULTS = 25;

@Injectable()
export class AudiobookCoversCoverProvider implements CoverProvider {
  readonly key = AUDIOBOOKCOVERS_PROVIDER_KEY;

  private readonly logger = new Logger(AudiobookCoversCoverProvider.name);
  private static readonly SEARCH_URL = 'https://www.audiobookcovers.com/search';

  async search(params: CoverSearchParams): Promise<CoverSearchResult[]> {
    if (!params.isAudiobook) return [];

    const query = this.buildQuery(params);
    if (!query) return [];

    const url = new URL(AudiobookCoversCoverProvider.SEARCH_URL);
    url.searchParams.set('q', query);

    try {
      const response = await fetch(url.toString(), {
        headers: {
          'User-Agent': COVER_PROXY_USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        this.logger.warn(`Search failed with status ${response.status} for query "${sanitizeLogValue(query)}"`);
        return [];
      }

      const html = await response.text();
      return this.parseResults(html).slice(0, MAX_RESULTS);
    } catch (error) {
      this.logger.warn(`Search failed for query "${sanitizeLogValue(query)}": ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  private parseResults(html: string): CoverSearchResult[] {
    const results: CoverSearchResult[] = [];
    const seenIds = new Set<string>();

    for (const match of html.matchAll(RESULT_PATTERN)) {
      const [, id, previewUrl, , fullUrl] = match;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      results.push({
        url: fullUrl,
        sourceUrl: fullUrl,
        previewUrl,
        width: COVER_SIZE,
        height: COVER_SIZE,
        source: 'AudiobookCovers',
      });
    }

    return results;
  }

  private buildQuery(params: CoverSearchParams): string {
    const title = params.title?.trim() ?? '';
    const author = params.author?.trim() ?? '';
    return author ? `${title} ${author}`.trim() : title;
  }
}
