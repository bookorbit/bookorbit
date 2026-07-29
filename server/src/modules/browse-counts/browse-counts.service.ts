import { Injectable } from '@nestjs/common';

import type { BrowseCounts } from '@bookorbit/types';
import { StatsCache } from '../../common/cache/stats-cache';
import type { RequestUser } from '../../common/types/request-user';
import { AnnotationHubService } from '../annotation/annotation-hub.service';
import { AuthorsService } from '../authors/authors.service';
import { SeriesService } from '../series/series.service';

const BROWSE_COUNTS_TTL_MS = 60_000;
const BROWSE_COUNTS_CACHE_MAX_ENTRIES = 200;

/**
 * Feeds the sidebar Browse badges. Every shell mount asks for all three totals at once,
 * so they are fanned out in parallel and cached per user to keep them off the hot path.
 */
@Injectable()
export class BrowseCountsService {
  private readonly cache = new StatsCache({ ttlMs: BROWSE_COUNTS_TTL_MS, maxEntries: BROWSE_COUNTS_CACHE_MAX_ENTRIES });

  constructor(
    private readonly authorsService: AuthorsService,
    private readonly seriesService: SeriesService,
    private readonly annotationHubService: AnnotationHubService,
  ) {}

  async getCounts(user: RequestUser): Promise<BrowseCounts> {
    return this.cache.get(String(user.id), 'browse-counts', async () => {
      const [authors, series, annotations] = await Promise.all([
        this.authorsService.countAll(user),
        this.seriesService.countAll(user),
        this.annotationHubService.countActive(user.id),
      ]);
      return { authors, series, annotations };
    });
  }
}
