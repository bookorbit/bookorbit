import { Injectable, Logger } from '@nestjs/common';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { createHash } from 'crypto';
import type { BookRequestMediaKind, IndexerTestResult } from '@bookorbit/types';
import { MAX_INDEXER_RELEASE_GUID_LENGTH } from '@bookorbit/types';

import { readBoundedBytes, ResponseTooLargeError } from '../../../../common/utils/bounded-response';
import { sanitizeLogValue } from '../../../../common/utils/log-sanitize.utils';
import { safeFetch } from '../../../../common/utils/safe-fetch';
import { ensureSafeUrl, PrivateAddressException } from '../../../../common/utils/ssrf.utils';
import { buildSearchText } from '../search-text';
import {
  IndexerSearchException,
  type IndexerAdapter,
  type ReleaseCandidate,
  type ReleaseQuery,
  type ResolvedIndexerConfig,
} from '../indexer-adapter';

const MAX_XML_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_NZB_FILE_BYTES = 32 * 1024 * 1024;
const MAX_FEED_ITEMS = 500;
const MAX_FEED_FIELD_CHARS = MAX_INDEXER_RELEASE_GUID_LENGTH;
const REQUEST_TIMEOUT_MS = 25_000;
const MAX_REDIRECTS = 5;
const XML_ACCEPT = 'application/rss+xml, application/xml, text/xml, */*;q=0.1';
const NZB_ACCEPT = 'application/x-nzb, application/xml, text/xml, */*;q=0.1';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });

interface NewznabAttr {
  '@_name'?: string;
  '@_value'?: string | number;
}

interface NewznabItem {
  title?: string;
  guid?: unknown;
  link?: string;
  size?: string | number;
  pubDate?: string;
  category?: string | string[];
  enclosure?: { '@_url'?: string; '@_length'?: string | number } | Array<{ '@_url'?: string; '@_length'?: string | number }>;
  'newznab:attr'?: NewznabAttr | NewznabAttr[];
  'torznab:attr'?: NewznabAttr | NewznabAttr[];
}

@Injectable()
export class NewznabAdapter implements IndexerAdapter {
  readonly type = 'newznab' as const;
  readonly label = 'Newznab';
  readonly mediaKinds: readonly BookRequestMediaKind[] = ['ebook', 'audiobook', 'comic'];
  readonly supportsIsbnSearch = true;
  readonly requiresCredential = true;

  private readonly logger = new Logger(NewznabAdapter.name);

  async search(query: ReleaseQuery, config: ResolvedIndexerConfig, signal: AbortSignal): Promise<ReleaseCandidate[]> {
    const searchText = query.isbn13 ?? buildSearchText(query);
    const params = new URLSearchParams({ t: 'search', q: searchText, limit: String(query.limit), extended: '1' });
    params.set('apikey', requireCredential(config));
    const categories = config.categories[query.mediaKind];
    if (categories.length > 0) params.set('cat', categories.join(','));

    return parseItems(await this.callXml(config, params, signal), config.id);
  }

  async test(config: ResolvedIndexerConfig): Promise<IndexerTestResult> {
    const params = new URLSearchParams({ t: 'caps', apikey: requireCredential(config) });
    const startedAt = Date.now();
    try {
      const xml = await this.callXml(config, params, AbortSignal.timeout(REQUEST_TIMEOUT_MS));
      const parsed = parser.parse(xml) as { caps?: { server?: { '@_title'?: string } } };
      if (!parsed.caps) return { success: false, error: 'That URL answered, but not with a Newznab capabilities document' };
      return { success: true, indexerName: parsed.caps.server?.['@_title'] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[request_indexer.test] [fail] indexerId=${config.id} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.constructor.name : 'Error'} error="${sanitizeLogValue(message)}" - newznab test failed`,
      );
      return { success: false, error: message };
    }
  }

  async fetchNzbFile(release: ReleaseCandidate, config: ResolvedIndexerConfig): Promise<Buffer> {
    if (!release.downloadUrl) throw new IndexerSearchException('error', 'That release has no NZB download link');

    try {
      let current = await ensureSafeUrl(release.downloadUrl, { allowPrivate: config.allowPrivateAddress });
      const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const response = await safeFetch(
          current.href,
          { signal, redirect: 'manual', headers: { Accept: NZB_ACCEPT } },
          { allowPrivate: config.allowPrivateAddress, profile: config.networkProfile, pinResolvedAddress: true },
        );

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          void response.body?.cancel().catch(() => undefined);
          if (!location) throw new IndexerSearchException('error', `The indexer answered ${response.status} without saying where the NZB is`);
          current = await ensureSafeUrl(new URL(location, current).href, { allowPrivate: config.allowPrivateAddress });
          continue;
        }

        if (!response.ok) throw new IndexerSearchException('error', `The indexer answered ${response.status} for that NZB`);
        const body = await readBounded(response, MAX_NZB_FILE_BYTES, 'The indexer returned an NZB that is too large');
        assertNzb(body);
        return body;
      }

      throw new IndexerSearchException('error', `That NZB link redirected more than ${MAX_REDIRECTS} times`);
    } catch (error) {
      if (error instanceof IndexerSearchException) throw error;
      if (error instanceof PrivateAddressException) throw new IndexerSearchException('error', error.message);
      if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
        throw new IndexerSearchException('timeout', `${config.name} did not return the NZB in time`);
      }
      throw new IndexerSearchException(
        'unreachable',
        `Could not fetch the NZB from ${config.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async callXml(config: ResolvedIndexerConfig, params: URLSearchParams, signal: AbortSignal): Promise<string> {
    const options = { allowPrivate: config.allowPrivateAddress, profile: config.networkProfile, pinResolvedAddress: true };
    let current = await endpointUrl(config, params);
    let response: Response | null = null;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      try {
        response = await safeFetch(current.href, { signal, redirect: 'manual', headers: { Accept: XML_ACCEPT } }, options);
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
    if (response.status === 401 || response.status === 403) throw new IndexerSearchException('unauthorized', `${config.name} rejected the API key`);
    if (!response.ok) throw new IndexerSearchException('error', `${config.name} answered ${response.status}`);

    const body = (await readBounded(response, MAX_XML_RESPONSE_BYTES, `${config.name} answered with more XML than BookOrbit will read`)).toString(
      'utf8',
    );
    const error = readErrorElement(body);
    if (error) throw new IndexerSearchException(error.failure, `${config.name}: ${error.description}`);
    return body;
  }
}

export function newznabClientKey(indexerId: number, guid: string): string {
  return createHash('sha256').update(String(indexerId)).update('\0').update(guid).digest('hex');
}

function requireCredential(config: ResolvedIndexerConfig): string {
  if (!config.credential) throw new IndexerSearchException('unauthorized', `${config.name} needs an API key`);
  return config.credential;
}

async function endpointUrl(config: ResolvedIndexerConfig, params: URLSearchParams): Promise<URL> {
  const base = await ensureSafeUrl(config.baseUrl, { allowPrivate: config.allowPrivateAddress });
  const prefix = base.pathname.replace(/\/+$/, '');
  const target = new URL(base.href);
  const completeEndpoint = prefix.endsWith('/api') || /\/api\/v\d+\/indexer\/\d+\/newznab$/i.test(prefix);
  target.pathname = completeEndpoint ? prefix : `${prefix}/api`;
  const merged = new URLSearchParams(base.search);
  for (const key of new Set(params.keys())) merged.delete(key);
  for (const [key, value] of params) merged.append(key, value);
  target.search = merged.toString();
  target.hash = '';
  return target;
}

async function readBounded(response: Response, limit: number, message: string): Promise<Buffer> {
  try {
    return await readBoundedBytes(response, limit);
  } catch (error) {
    if (error instanceof ResponseTooLargeError) throw new IndexerSearchException('error', message);
    throw error;
  }
}

function assertNzb(body: Buffer): void {
  if (body.byteLength === 0) throw new IndexerSearchException('error', 'The indexer returned an empty NZB');
  const xml = body.toString('utf8');
  if (!/<nzb\b/i.test(xml.slice(0, 4096)) || XMLValidator.validate(xml) !== true) {
    throw new IndexerSearchException('error', 'The indexer response was not a valid NZB document');
  }
}

function readErrorElement(body: string): { failure: 'unauthorized' | 'error'; description: string } | null {
  const element = /<error\b[^>]*\/?>/i.exec(body);
  if (!element) return null;
  const description = /\bdescription="([^"]*)"/i.exec(element[0])?.[1] ?? 'the indexer reported an error';
  const code = Number(/\bcode="(\d+)"/i.exec(element[0])?.[1]);
  return { failure: Number.isFinite(code) && code >= 100 && code < 200 ? 'unauthorized' : 'error', description };
}

function parseItems(xml: string, indexerId: number): ReleaseCandidate[] {
  const parsed = parser.parse(xml) as { rss?: { channel?: { item?: NewznabItem | NewznabItem[] } } };
  return toArray(parsed.rss?.channel?.item)
    .slice(0, MAX_FEED_ITEMS)
    .flatMap((item) => {
      const title = typeof item.title === 'string' ? item.title.trim() : '';
      if (!title || !withinBound(title)) return [];
      const attrs = attrMap(item);
      const enclosure = toArray(item.enclosure)[0];
      const link = item.link ?? enclosure?.['@_url'];
      const sourceGuid = readGuid(item);
      if (!withinBound(sourceGuid) || !withinBound(link) || !link || !/^https?:/i.test(link)) return [];
      const guid = publicReleaseGuid(indexerId, sourceGuid ?? link);
      const publishedAt = parseDate(item.pubDate);
      const fileCount = toNumber(attrs.get('files'));
      const format = attrs.get('format');
      return [
        {
          indexerId,
          guid,
          title,
          downloadUrl: link,
          sizeBytes: toNumber(attrs.get('size') ?? item.size ?? enclosure?.['@_length']),
          seeders: null,
          leechers: null,
          ...(attrs.get('author') ? { author: attrs.get('author') } : {}),
          ...(attrs.get('language') ? { language: attrs.get('language') } : {}),
          ...(attrs.get('booktitle') ? { bookTitle: attrs.get('booktitle') } : {}),
          ...(attrs.get('isbn') ? { isbn: attrs.get('isbn') } : {}),
          ...(format ? { format } : {}),
          ...(publishedAt ? { publishedAt } : {}),
          ...(fileCount !== null ? { fileCount } : {}),
        } satisfies ReleaseCandidate,
      ];
    });
}

function attrMap(item: NewznabItem): Map<string, string> {
  const map = new Map<string, string>();
  for (const attr of [...toArray(item['newznab:attr']), ...toArray(item['torznab:attr'])]) {
    const name = attr['@_name']?.toLowerCase();
    const value = attr['@_value'];
    if (!name || value === undefined || map.has(name)) continue;
    const text = String(value);
    if (withinBound(text)) map.set(name, text);
  }
  return map;
}

function readGuid(item: NewznabItem): string | undefined {
  if (typeof item.guid === 'string' && item.guid.trim()) return item.guid.trim();
  if (typeof item.guid === 'number') return String(item.guid);
  if (item.guid && typeof item.guid === 'object') {
    const text = (item.guid as { '#text'?: unknown })['#text'];
    if (typeof text === 'string' && text.trim()) return text.trim();
    if (typeof text === 'number') return String(text);
  }
  return undefined;
}

/** A URL-shaped GUID can carry the API key, so expose only a stable opaque identifier for it. */
function publicReleaseGuid(indexerId: number, value: string): string {
  if (!/^https?:/i.test(value)) return value;
  return createHash('sha256').update(String(indexerId)).update('\0release\0').update(value).digest('hex');
}

function withinBound(value: string | undefined): boolean {
  return value === undefined || value.length <= MAX_FEED_FIELD_CHARS;
}

function toNumber(value: string | number | undefined | null): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}
