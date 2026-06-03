import { Injectable, Logger } from '@nestjs/common';
import { CoverSearchResult, type ITunesCoverResolution } from '@bookorbit/types';

import { ProviderConfigService } from '../../metadata-preferences/provider-config.service';
import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { CoverProvider, CoverSearchParams, ITUNES_PROVIDER_KEY } from './cover-provider';

type ITunesCoverSearchResult = {
  artworkUrl100?: string;
};

type ITunesCoverSearchResponse = {
  resultCount: number;
  results: ITunesCoverSearchResult[];
};

@Injectable()
export class ITunesCoverProvider implements CoverProvider {
  readonly key = ITUNES_PROVIDER_KEY;

  private readonly logger = new Logger(ITunesCoverProvider.name);
  private static readonly SEARCH_URL = 'https://itunes.apple.com/search';

  constructor(private readonly providerConfig: ProviderConfigService) {}

  async search(params: CoverSearchParams): Promise<CoverSearchResult[]> {
    const { enabled, coverResolution } = await this.providerConfig.getConfig().then((config) => config.itunes);
    if (!enabled && !params.ignoreProviderEnabled) return [];

    const query = this.buildQuery(params);
    if (!query) return [];
    const entity = params.isAudiobook ? 'audiobook' : 'ebook';

    const primary = await this.searchOnce(query, entity, coverResolution);
    if (primary.length > 0 || !params.author?.trim()) return primary;
    return this.searchOnce(params.title.trim(), entity, coverResolution);
  }

  private async searchOnce(query: string, entity: 'ebook' | 'audiobook', coverResolution: ITunesCoverResolution): Promise<CoverSearchResult[]> {
    const url = new URL(ITunesCoverProvider.SEARCH_URL);
    url.searchParams.set('term', query);
    url.searchParams.set('entity', entity);
    url.searchParams.set('limit', '25');

    const size = coverResolution === 'high' ? 10_000 : 600;
    const previewSize = 300;

    try {
      const response = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) {
        this.logger.warn(`Search failed with status ${response.status} for query "${sanitizeLogValue(query)}"`);
        return [];
      }

      const body = (await response.json()) as ITunesCoverSearchResponse;
      const mapped: Array<CoverSearchResult | null> = body.results.map((result) => {
        if (!result.artworkUrl100) return null;
        const sourceUrl = this.resizeArtworkUrl(result.artworkUrl100, size);
        const previewUrl = this.resizeArtworkUrl(result.artworkUrl100, previewSize);
        const mappedResult: CoverSearchResult = {
          url: sourceUrl,
          sourceUrl,
          previewUrl,
          width: size,
          height: size,
          source: 'iTunes',
        };
        return mappedResult;
      });
      return mapped.filter((result): result is CoverSearchResult => result !== null);
    } catch (error) {
      this.logger.warn(`Search failed for query "${sanitizeLogValue(query)}": ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  private buildQuery(params: CoverSearchParams): string {
    const title = params.title?.trim() ?? '';
    const author = params.author?.trim() ?? '';
    return author ? `${title} ${author}`.trim() : title;
  }

  private resizeArtworkUrl(url: string, size: number): string {
    if (!url.includes('100x100bb')) return url;
    return url.replace(/100x100bb\.[a-z0-9]+(?=$|\?)/i, `${size}x${size}bb.jpg`);
  }
}
