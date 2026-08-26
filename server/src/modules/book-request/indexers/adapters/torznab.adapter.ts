import { Injectable, Logger } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import type { BookRequestMediaKind, IndexerTestResult } from '@bookorbit/types';

import { readBoundedBytes, ResponseTooLargeError } from '../../../../common/utils/bounded-response';
import { sanitizeLogValue } from '../../../../common/utils/log-sanitize.utils';
import { safeFetch } from '../../../../common/utils/safe-fetch';
import { ensureSafeUrl } from '../../../../common/utils/ssrf.utils';
import {
  IndexerSearchException,
  type IndexerAdapter,
  type ReleaseCandidate,
  type ReleaseQuery,
  type ResolvedIndexerConfig,
} from '../indexer-adapter';
// An ISBN is the one query a tracker almost never indexes, so it stays out of the search text.
import { buildSearchText } from '../search-text';
import { MAX_TORRENT_FILE_BYTES } from '../../fulfillment/torrent.utils';

/**
 * A generous ceiling on a feed document, not an expectation. A hundred extended results run to a
 * few hundred kilobytes and a Jackett capabilities document to rather less; a body past this is a
 * stream that will not end rather than a feed worth parsing.
 */
const MAX_XML_RESPONSE_BYTES = 16 * 1024 * 1024;
/**
 * Bounds inside the byte bound. 16MB is generous enough to hold a hundred thousand tiny items, or
 * one item carrying a megabyte of title, and every one of them would be parsed, scored, deduped
 * and cached: a feed nobody vets should not be able to spend seconds of synchronous CPU per
 * search. Ten times what any search asks any indexer for, and no honest title or link is 4KB.
 */
const MAX_FEED_ITEMS = 500;
const MAX_FEED_FIELD_CHARS = 4_096;
const REQUEST_TIMEOUT_MS = 25_000;
/** The same ceiling the direct fetcher uses, and for the same reason: a chain, not a loop. */
const MAX_REDIRECTS = 5;

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });

interface TorznabItem {
  title?: string;
  guid?: unknown;
  link?: string;
  size?: string | number;
  pubDate?: string;
  enclosure?: { '@_url'?: string; '@_length'?: string | number } | Array<{ '@_url'?: string; '@_length'?: string | number }>;
  'torznab:attr'?: TorznabAttr | TorznabAttr[];
}

interface TorznabAttr {
  '@_name'?: string;
  '@_value'?: string;
}

/**
 * The generic adapter, and deliberately the first one built: proving the interface on the case
 * every torznab proxy speaks keeps a single tracker's quirks from shaping the abstraction.
 */
@Injectable()
export class TorznabAdapter implements IndexerAdapter {
  readonly type = 'torznab' as const;
  readonly label = 'Torznab';
  /** Whatever the proxy behind it indexes, which is every medium a request can ask for. */
  readonly mediaKinds: readonly BookRequestMediaKind[] = ['ebook', 'audiobook', 'comic'];
  readonly supportsIsbnSearch = false;
  /** Jackett and Prowlarr want an API key, but a self-hosted proxy may be left open. */
  readonly requiresCredential = false;

  private readonly logger = new Logger(TorznabAdapter.name);

  async search(query: ReleaseQuery, config: ResolvedIndexerConfig, signal: AbortSignal): Promise<ReleaseCandidate[]> {
    const params = new URLSearchParams({ t: 'search', q: buildSearchText(query), limit: String(query.limit), extended: '1' });
    if (config.credential) params.set('apikey', config.credential);
    const categories = config.categories[query.mediaKind];
    if (categories.length > 0) params.set('cat', categories.join(','));

    const xml = await this.callXml(config, params, signal);
    return parseItems(xml, config.id);
  }

  async test(config: ResolvedIndexerConfig): Promise<IndexerTestResult> {
    const params = new URLSearchParams({ t: 'caps' });
    if (config.credential) params.set('apikey', config.credential);

    try {
      const xml = await this.callXml(config, params, AbortSignal.timeout(REQUEST_TIMEOUT_MS));
      const parsed = parser.parse(xml) as { caps?: { server?: { '@_title'?: string; '@_version'?: string } } };
      const server = parsed.caps?.server;
      if (!parsed.caps) {
        return { success: false, error: 'That URL answered, but not with a torznab capabilities document' };
      }
      return { success: true, indexerName: server?.['@_title'] ?? undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[request_indexer.test] [fail] indexerId=${config.id} error="${sanitizeLogValue(message)}" - torznab test failed`);
      return { success: false, error: message };
    }
  }

  /**
   * Torznab links are one-shot, credentialed URLs, so the fetch goes through the same host check
   * as everything else rather than being handed to the download client to open.
   *
   * This is the one URL on the adapter that a tracker chose rather than an operator, so it gets
   * the strong shape: redirects followed by hand with every hop checked, the connection pinned to
   * the address that passed, the operator's egress honoured, and the body counted as it arrives.
   */
  async fetchTorrentFile(release: ReleaseCandidate, config: ResolvedIndexerConfig): Promise<Buffer> {
    if (!release.downloadUrl) throw new IndexerSearchException('error', 'That release has no download link');

    const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let current = await ensureSafeUrl(release.downloadUrl, { allowPrivate: config.allowPrivateAddress });

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const response = await safeFetch(
        current.href,
        { signal: deadline, redirect: 'manual', headers: { Accept: 'application/x-bittorrent, */*' } },
        { allowPrivate: config.allowPrivateAddress, profile: config.networkProfile, pinResolvedAddress: true },
      );

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        void response.body?.cancel().catch(() => undefined);
        if (!location) throw new IndexerSearchException('error', `The indexer answered ${response.status} without saying where the file is`);
        current = await ensureSafeUrl(new URL(location, current).href, { allowPrivate: config.allowPrivateAddress });
        continue;
      }

      if (!response.ok) throw new IndexerSearchException('error', `The indexer answered ${response.status} for that download link`);

      const body = await readBounded(response, MAX_TORRENT_FILE_BYTES, 'The indexer returned a .torrent file that is too large');
      if (body.byteLength === 0) throw new IndexerSearchException('error', 'The indexer returned an empty .torrent file');
      return body;
    }

    throw new IndexerSearchException('error', `That download link redirected more than ${MAX_REDIRECTS} times`);
  }

  /**
   * A search or a capabilities call, with the redirect chain walked by hand.
   *
   * `redirect: 'follow'` checks the first URL and nothing after it: the global fetch then takes up
   * to twenty hops unchecked, so a compromised or intercepted indexer can answer 302 pointing at
   * loopback or a link-local metadata address and have the body read and parsed. This is the same
   * shape `fetchTorrentFile` already uses. The API key needs no separate handling: it rides in the
   * query string, and a redirect target carries only the query the indexer itself named.
   */
  private async callXml(config: ResolvedIndexerConfig, params: URLSearchParams, signal: AbortSignal): Promise<string> {
    const options = { allowPrivate: config.allowPrivateAddress, profile: config.networkProfile, pinResolvedAddress: true };
    let current = await this.endpointUrl(config, params);
    let response: Response | null = null;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      try {
        response = await safeFetch(current.href, { signal, redirect: 'manual', headers: { Accept: 'application/xml, text/xml' } }, options);
      } catch (error) {
        if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
          throw new IndexerSearchException('timeout', `${config.name} did not answer in time`);
        }
        throw new IndexerSearchException('unreachable', `Could not reach ${config.name}: ${error instanceof Error ? error.message : String(error)}`);
      }

      if (response.status < 300 || response.status >= 400) break;

      const location = response.headers.get('location');
      void response.body?.cancel().catch(() => undefined);
      if (!location) throw new IndexerSearchException('error', `${config.name} answered ${response.status} without saying where to go`);
      current = await ensureSafeUrl(new URL(location, current).href, options);
      response = null;
    }

    if (!response) throw new IndexerSearchException('error', `${config.name} redirected more than ${MAX_REDIRECTS} times`);

    if (response.status === 429) throw new IndexerSearchException('throttled', `${config.name} is rate limiting us`);
    if (response.status === 401 || response.status === 403) {
      throw new IndexerSearchException('unauthorized', `${config.name} rejected the API key`);
    }
    if (!response.ok) throw new IndexerSearchException('error', `${config.name} answered ${response.status}`);

    const body = (await readBounded(response, MAX_XML_RESPONSE_BYTES, `${config.name} answered with more XML than BookOrbit will read`)).toString(
      'utf8',
    );
    // Torznab reports its own failures as a 200 carrying an <error> element, so the status alone
    // is not the answer: an expired key would otherwise read as "no releases found".
    const error = readErrorElement(body);
    if (error) throw new IndexerSearchException(error.failure, `${config.name}: ${error.description}`);
    return body;
  }

  /**
   * `new URL('/api', base)` throws away any path the base carries, which breaks every Jackett
   * deployment (its endpoints live under `/api/v2.0/indexers/<id>/results/torznab`). Join under
   * the base's own path instead, and accept a base that already ends in `/api`.
   *
   * Anything the base's own query string carries is kept underneath what this call asks for. Some
   * proxies hand the operator a base with the key already in it (`.../api?apikey=...`), and
   * replacing the query wholesale dropped it, so the indexer answered every search with a 401 that
   * looked like a wrong key. Our own parameters still win, so `t`, `q` and the rest are never
   * shadowed by a stale copy in the base.
   */
  private async endpointUrl(config: ResolvedIndexerConfig, params: URLSearchParams): Promise<URL> {
    const base = await ensureSafeUrl(config.baseUrl, { allowPrivate: config.allowPrivateAddress });
    const prefix = base.pathname.replace(/\/+$/, '');
    const target = new URL(base.href);
    target.pathname = prefix.endsWith('/api') ? prefix : `${prefix}/api`;

    const merged = new URLSearchParams(base.search);
    for (const key of new Set(params.keys())) merged.delete(key);
    for (const [key, value] of params) merged.append(key, value);
    target.search = merged.toString();
    target.hash = '';
    return target;
  }
}

/**
 * A ceiling breach is the indexer misbehaving, so it reaches the picker as an indexer failure
 * rather than as an unexplained crash halfway through a search.
 */
async function readBounded(response: Response, limitBytes: number, message: string): Promise<Buffer> {
  try {
    return await readBoundedBytes(response, limitBytes);
  } catch (error) {
    if (error instanceof ResponseTooLargeError) throw new IndexerSearchException('error', message);
    throw error;
  }
}

/**
 * Newznab reserves the 100 block for credential and account failures, which is the distinction
 * worth surfacing: a wrong key is the operator's to fix, anything else is the tracker's.
 */
function readErrorElement(body: string): { failure: 'unauthorized' | 'error'; description: string } | null {
  const element = /<error\b[^>]*\/?>/i.exec(body);
  if (!element) return null;

  const description = /\bdescription="([^"]*)"/i.exec(element[0])?.[1] ?? 'the indexer reported an error';
  const code = Number(/\bcode="(\d+)"/i.exec(element[0])?.[1]);
  return { failure: Number.isFinite(code) && code >= 100 && code < 200 ? 'unauthorized' : 'error', description };
}

function parseItems(xml: string, indexerId: number): ReleaseCandidate[] {
  const parsed = parser.parse(xml) as { rss?: { channel?: { item?: TorznabItem | TorznabItem[] } } };
  // Bounded before the loop, so an item count nobody asked for costs one slice rather than a pass.
  const items = toArray(parsed.rss?.channel?.item).slice(0, MAX_FEED_ITEMS);

  const releases: ReleaseCandidate[] = [];
  for (const item of items) {
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    if (!title || !withinFieldBound(title)) continue;

    const attrs = attrMap(item);
    const enclosure = toArray(item.enclosure)[0];
    const guid = readGuid(item) ?? enclosure?.['@_url'] ?? title;
    if (!withinFieldBound(guid)) continue;
    // A proxy may publish the release as a magnet in `link`, in an enclosure, or in an attribute.
    const link = withinFieldBound(item.link ?? enclosure?.['@_url']) ? (item.link ?? enclosure?.['@_url']) : undefined;
    const magnet = attrs.get('magneturl') ?? (link?.startsWith('magnet:') ? link : undefined);
    const downloadUrl = link && !link.startsWith('magnet:') ? link : undefined;
    const infoHash = attrs.get('infohash');
    // A bare count includes cover art, so it is a scoring penalty rather than a hard filter.
    const fileCount = toNumber(attrs.get('files'));
    const publishedAt = parseDate(item.pubDate);
    // What the tracker asks of a grab, which a proxy passes through from the tracker's own rules.
    // Torznab states the seed time in seconds; our column and the download clients want minutes.
    const seedRatioGoal = toNumber(attrs.get('minimumratio'));
    const seedTimeSeconds = toNumber(attrs.get('minimumseedtime'));
    const seedTimeMinutes = seedTimeSeconds === null ? null : Math.round(seedTimeSeconds / 60);
    const bookTitle = attrs.get('booktitle')?.trim();

    releases.push({
      indexerId,
      guid,
      title,
      ...(bookTitle ? { bookTitle } : {}),
      ...(downloadUrl ? { downloadUrl } : {}),
      ...(magnet ? { magnet } : {}),
      ...(infoHash ? { infoHash: infoHash.toLowerCase() } : {}),
      sizeBytes: toNumber(attrs.get('size') ?? item.size ?? enclosure?.['@_length']),
      seeders: toNumber(attrs.get('seeders')),
      leechers: leecherCount(attrs),
      ...(attrs.get('author') ? { author: attrs.get('author') } : {}),
      ...(attrs.get('language') ? { language: attrs.get('language') } : {}),
      // Torznab reports freeleech as a downloadvolumefactor of 0: the release costs no download.
      freeleech: toNumber(attrs.get('downloadvolumefactor')) === 0,
      ...(publishedAt ? { publishedAt } : {}),
      ...(fileCount !== null ? { fileCount } : {}),
      ...(seedRatioGoal !== null ? { seedRatioGoal } : {}),
      ...(seedTimeMinutes !== null ? { seedTimeMinutes } : {}),
    });
  }

  return releases;
}

/** `peers` counts seeders too, so leechers is the difference rather than the raw number. */
function leecherCount(attrs: Map<string, string>): number | null {
  const explicit = toNumber(attrs.get('leechers'));
  if (explicit !== null) return explicit;
  const peers = toNumber(attrs.get('peers'));
  if (peers === null) return null;
  return Math.max(0, peers - (toNumber(attrs.get('seeders')) ?? 0));
}

/** An unparseable pubDate would otherwise throw out of the whole feed on `toISOString()`. */
function parseDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function attrMap(item: TorznabItem): Map<string, string> {
  const map = new Map<string, string>();
  for (const attr of toArray(item['torznab:attr'])) {
    const name = attr['@_name']?.toLowerCase();
    const value = attr['@_value'];
    if (!name || value === undefined || map.has(name)) continue;
    // Bounded here rather than per field: every attribute-derived value on a release, from the
    // magnet link to the language, passes through this map.
    const text = String(value);
    if (withinFieldBound(text)) map.set(name, text);
  }
  return map;
}

/** A title, link or attribute longer than the bound is not one; the item is dropped rather than kept. */
function withinFieldBound(value: string | undefined): boolean {
  return value === undefined || value.length <= MAX_FEED_FIELD_CHARS;
}

/** `guid` is a bare string on some proxies and `{ '#text', '@_isPermaLink' }` on others. */
function readGuid(item: TorznabItem): string | undefined {
  const guid = item.guid;
  if (typeof guid === 'string' && guid.trim()) return guid.trim();
  if (typeof guid === 'number') return String(guid);
  if (guid && typeof guid === 'object') {
    const text = (guid as { '#text'?: unknown })['#text'];
    if (typeof text === 'string' && text.trim()) return text.trim();
    if (typeof text === 'number') return String(text);
  }
  return undefined;
}

function toNumber(value: string | number | undefined | null): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}
