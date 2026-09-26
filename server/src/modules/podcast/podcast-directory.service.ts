import { BadGatewayException, Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { PODCAST_DIRECTORY_SEARCH_MAX_RESULTS } from '@bookorbit/types';
import type { PodcastDirectoryResult } from '@bookorbit/types';
import { podcastConfig } from '../../config/config';

/**
 * The one host this service is ever allowed to talk to. The URL is assembled here from a
 * constant origin and an encoded term, so a search string can never redirect egress somewhere
 * else: there is no SSRF surface to defend.
 */
const DIRECTORY_SEARCH_URL = 'https://itunes.apple.com/search';
const CACHE_TTL_MS = 10 * 60_000;
/** Bounded so a stream of distinct searches cannot grow the cache without limit. */
const CACHE_MAX_ENTRIES = 200;
/** Directory search backs a keystroke-driven field, so it fails fast rather than hanging the UI. */
const MAX_TIMEOUT_MS = 10_000;

/**
 * A directory row as the cache holds it: the API result without the per-caller subscription
 * annotation, which depends on who is asking and so must never be stored alongside the shared row.
 */
export type PodcastDirectoryEntry = Omit<PodcastDirectoryResult, 'existingPodcastId' | 'existingLibraryId'>;

interface CacheEntry {
  expiresAt: number;
  results: PodcastDirectoryEntry[];
}

@Injectable()
export class PodcastDirectoryService {
  private readonly logger = new Logger(PodcastDirectoryService.name);
  private readonly timeoutMs: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(@Inject(podcastConfig.KEY) config: ConfigType<typeof podcastConfig>) {
    this.timeoutMs = Math.min(config.requestTimeoutMs, MAX_TIMEOUT_MS);
  }

  /**
   * Every query fetches and caches the full result ceiling and slices on read, so two clients
   * asking for the same term with different limits share one upstream request.
   */
  async search(term: string, limit: number): Promise<PodcastDirectoryEntry[]> {
    const normalized = normalizeTerm(term);
    if (!normalized) return [];

    const cached = this.cache.get(normalized);
    if (cached && cached.expiresAt > Date.now()) return cached.results.slice(0, limit);

    const results = await this.fetchDirectory(normalized);
    this.store(normalized, results);
    return results.slice(0, limit);
  }

  private async fetchDirectory(term: string): Promise<PodcastDirectoryEntry[]> {
    const event = 'podcast.directory_search';
    const startedAt = Date.now();
    const url = new URL(DIRECTORY_SEARCH_URL);
    url.searchParams.set('media', 'podcast');
    url.searchParams.set('entity', 'podcast');
    url.searchParams.set('limit', String(PODCAST_DIRECTORY_SEARCH_MAX_RESULTS));
    url.searchParams.set('term', term);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'BookOrbit Podcast/1.0' },
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new BadGatewayException('Podcast directory search is unavailable');
      }
      const payload: unknown = await response.json();
      const results = mapDirectoryResults(payload);
      // The search term itself is user content and stays out of the log; the shape of the
      // response is what matters when this endpoint misbehaves.
      this.logger.log(`[${event}] [end] durationMs=${Date.now() - startedAt} results=${results.length} - directory search completed`);
      return results;
    } catch (error) {
      const mapped =
        error instanceof BadGatewayException
          ? error
          : error instanceof Error && error.name === 'AbortError'
            ? new BadGatewayException('Podcast directory search timed out')
            : new BadGatewayException('Podcast directory search is unavailable');
      this.logger.warn(`[${event}] [fail] durationMs=${Date.now() - startedAt} error="${mapped.message}" - directory search failed`);
      throw mapped;
    } finally {
      clearTimeout(timeout);
    }
  }

  private store(term: string, results: PodcastDirectoryEntry[]): void {
    // Re-inserting moves the key to the end of the iteration order, so the oldest write is
    // always the first candidate for eviction.
    this.cache.delete(term);
    this.cache.set(term, { expiresAt: Date.now() + CACHE_TTL_MS, results });
    while (this.cache.size > CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next();
      if (oldest.done) break;
      this.cache.delete(oldest.value);
    }
  }
}

/** Cache keys ignore case and inner whitespace so trivially different typing shares one entry. */
function normalizeTerm(term: string): string {
  return term.trim().replace(/\s+/g, ' ').toLowerCase();
}

function mapDirectoryResults(payload: unknown): PodcastDirectoryEntry[] {
  const rows = (payload as { results?: unknown })?.results;
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const results: PodcastDirectoryEntry[] = [];
  for (const row of rows) {
    const entry = row as Record<string, unknown>;
    const feedUrl = typeof entry['feedUrl'] === 'string' ? entry['feedUrl'].trim() : '';
    const title = typeof entry['collectionName'] === 'string' ? entry['collectionName'].trim() : '';
    // A directory row without a usable feed is not an add-feed candidate, and the directory
    // does return them (delisted shows keep their artwork but lose the enclosure).
    if (!title || !isHttpUrl(feedUrl) || seen.has(feedUrl)) continue;
    seen.add(feedUrl);
    results.push({
      title,
      author: optionalText(entry['artistName']),
      feedUrl,
      artworkUrl: firstArtwork(entry),
      genre: optionalText(entry['primaryGenreName']),
    });
  }
  return results;
}

function isHttpUrl(value: string): boolean {
  if (!value) return false;
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function firstArtwork(entry: Record<string, unknown>): string | null {
  for (const key of ['artworkUrl600', 'artworkUrl100', 'artworkUrl60']) {
    const value = entry[key];
    if (typeof value === 'string' && isHttpUrl(value.trim())) return value.trim();
  }
  return null;
}

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
