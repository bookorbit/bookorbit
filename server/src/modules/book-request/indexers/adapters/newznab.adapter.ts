import { Injectable, Logger } from '@nestjs/common';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { createHash } from 'crypto';
import type { BookRequestMediaKind, IndexerTestResult } from '@bookorbit/types';
import { MAX_INDEXER_RELEASE_GUID_LENGTH } from '@bookorbit/types';

import { readBoundedBytes, ResponseTooLargeError } from '../../../../common/utils/bounded-response';
import { sanitizeLogValue } from '../../../../common/utils/log-sanitize.utils';
import { safeFetch } from '../../../../common/utils/safe-fetch';
import { ensureSafeUrl, PrivateAddressException } from '../../../../common/utils/ssrf.utils';
import { publicReleaseGuid } from '../release-guid';
import { buildSearchText } from '../search-text';
import {
  IndexerSearchException,
  IndexerRetryExhaustedException,
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
const MAX_RATE_LIMIT_RETRIES = 2;
const MAX_RATE_LIMIT_DELAY_MS = 10_000;
const DEFAULT_RATE_LIMIT_DELAY_MS = 1000;
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
  /** The release's details page, which the Newznab spec points at its comment thread. */
  comments?: unknown;
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
  readonly mediaKinds: readonly BookRequestMediaKind[] = ['ebook', 'audiobook'];
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
      const retries = { remaining: MAX_RATE_LIMIT_RETRIES };
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const response = await fetchWithRateLimitRetry(current.href, config, NZB_ACCEPT, signal, retries);

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          void response.body?.cancel().catch(() => undefined);
          if (!location) throw new IndexerSearchException('error', `The indexer answered ${response.status} without saying where the NZB is`);
          current = await ensureSafeUrl(new URL(location, current).href, { allowPrivate: config.allowPrivateAddress });
          continue;
        }

        if (!response.ok) {
          void response.body?.cancel().catch(() => undefined);
          throw new IndexerSearchException('error', `The indexer answered ${response.status} for that NZB`);
        }
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
    const retries = { remaining: MAX_RATE_LIMIT_RETRIES };

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      try {
        response = await fetchWithRateLimitRetry(current.href, config, XML_ACCEPT, signal, retries);
      } catch (error) {
        if (error instanceof IndexerSearchException) throw error;
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
    if (!response.ok) void response.body?.cancel().catch(() => undefined);
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

async function fetchWithRateLimitRetry(
  url: string,
  config: ResolvedIndexerConfig,
  accept: string,
  signal: AbortSignal,
  retries: { remaining: number },
): Promise<Response> {
  for (;;) {
    let response: Response;
    try {
      signal.throwIfAborted();
      response = await safeFetch(
        url,
        { signal, redirect: 'manual', headers: { Accept: accept } },
        { allowPrivate: config.allowPrivateAddress, profile: config.networkProfile, pinResolvedAddress: true },
      );
    } catch (error) {
      if (signal.aborted && retries.remaining < MAX_RATE_LIMIT_RETRIES) {
        throw new IndexerRetryExhaustedException('throttled', `${config.name} is rate limiting us beyond the request deadline`);
      }
      throw error;
    }
    if (response.status !== 429) return response;

    const delayMs = rateLimitDelay(response.headers.get('retry-after'));
    void response.body?.cancel().catch(() => undefined);
    if (retries.remaining === 0) {
      throw new IndexerRetryExhaustedException('throttled', `${config.name} is rate limiting us after ${MAX_RATE_LIMIT_RETRIES} retries`);
    }
    retries.remaining--;
    try {
      await waitForRateLimit(delayMs, signal);
    } catch (error) {
      // Restarting the generic grab retry after the deadline would exceed this bounded wait.
      if (signal.aborted) throw new IndexerRetryExhaustedException('throttled', `${config.name} is rate limiting us beyond the request deadline`);
      throw error;
    }
  }
}

function rateLimitDelay(header: string | null): number {
  const value = header?.trim();
  if (!value) return DEFAULT_RATE_LIMIT_DELAY_MS;
  if (/^\d+$/.test(value)) return Math.min(Number(value) * 1000, MAX_RATE_LIMIT_DELAY_MS);
  // Date.parse also accepts non-HTTP inputs such as "-1" as dates.
  const httpDate = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/i;
  const obsoleteDate = /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{2}-[A-Za-z]{3}-\d{2} \d{2}:\d{2}:\d{2} GMT$/i;
  const asctimeDate = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) [A-Za-z]{3} {1,2}\d{1,2} \d{2}:\d{2}:\d{2} \d{4}$/i;
  const date = httpDate.test(value) || obsoleteDate.test(value) ? Date.parse(value) : asctimeDate.test(value) ? Date.parse(`${value} GMT`) : NaN;
  return Number.isFinite(date) ? Math.min(Math.max(0, date - Date.now()), MAX_RATE_LIMIT_DELAY_MS) : DEFAULT_RATE_LIMIT_DELAY_MS;
}

async function waitForRateLimit(delayMs: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      const reason: unknown = signal.reason;
      reject(reason instanceof Error ? reason : new DOMException('The indexer wait was aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    signal.addEventListener('abort', abort, { once: true });
  });
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
      const infoUrl = readText(item.comments);
      const publishedAt = parseDate(item.pubDate);
      const fileCount = toNumber(attrs.get('files'));
      const format = attrs.get('format');
      return [
        {
          indexerId,
          guid,
          title,
          ...(infoUrl && withinBound(infoUrl) ? { infoUrl } : {}),
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
  return readText(item.guid);
}

/** An element's text, whether the parser handed it over bare or as `{ '#text', ...attributes }`. */
function readText(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object') {
    const text = (value as { '#text'?: unknown })['#text'];
    if (typeof text === 'string' && text.trim()) return text.trim();
    if (typeof text === 'number') return String(text);
  }
  return undefined;
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
