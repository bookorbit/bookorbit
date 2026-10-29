import { createHash } from 'crypto';
import { Logger } from '@nestjs/common';
import { parseSeriesIndex } from '@bookorbit/types';
import type {
  ConcreteBookMediaKind,
  ExternalMetadataProviderKey,
  MetadataCandidate,
  MetadataHttpProviderInfo,
  MetadataSeriesMembership,
} from '@bookorbit/types';

import { markProviderDegraded } from '../../../../common/provider-cache/provider-call-context';
import type { ProviderCacheSpec } from '../../../../common/provider-cache/provider-cache-spec';
import { splitMetadataIsbn } from '../../../../common/text-match/isbn-normalize';
import { sanitizeLogValue } from '../../../../common/utils/log-sanitize.utils';
import { HttpProviderClient, HttpProviderError } from '../../../metadata-http-provider/http-provider.client';
import type { ActiveHttpProvider } from '../../../metadata-http-provider/metadata-http-provider.catalog';
import { bookUrlFromTemplate, httpUrl } from '../../../metadata-http-provider/http-provider-info';
import { ProviderThrottleError } from '../../provider-throttle.error';
import type { MetadataProvider } from '../metadata-provider';
import type { MetadataSearchParams } from '../metadata-search-params';
import { providerCacheContext } from '../provider-cache';

/** Bump when the spec-to-candidate mapping below changes, so cached answers mapped the old way expire. */
const MAPPING_VERSION = 3;
const MAX_MATCHES = 50;
const MAX_TITLE = 1_000;
const MAX_DESCRIPTION = 50_000;
const MAX_ENTRY = 200;
const MAX_LIST = 100;

/** One record as the book-metadata-provider spec describes it, plus the extensions BookOrbit reads. */
interface SpecBookMetadata {
  mediaType?: unknown;
  providerId?: unknown;
  title?: unknown;
  subtitle?: unknown;
  author?: unknown;
  authors?: unknown;
  narrator?: unknown;
  narrators?: unknown;
  publisher?: unknown;
  publishedYear?: unknown;
  publishedDate?: unknown;
  description?: unknown;
  cover?: unknown;
  coverWidth?: unknown;
  coverHeight?: unknown;
  isbn?: unknown;
  isbn13?: unknown;
  isbn10?: unknown;
  genres?: unknown;
  series?: unknown;
  languageCode?: unknown;
  duration?: unknown;
  pages?: unknown;
  rating?: unknown;
  ratingCount?: unknown;
  url?: unknown;
}

const MEDIA_KINDS: Record<MetadataHttpProviderInfo['mediaTypes'][number], ConcreteBookMediaKind> = {
  book: 'ebook',
  audiobook: 'audiobook',
  comic: 'comic',
};

/**
 * An external provider seen as an ordinary BookOrbit provider. Everything provider-specific comes
 * from its `/provider/info` at runtime: the class itself names no provider, so a new one needs no
 * code here.
 */
export class HttpMetadataProvider implements MetadataProvider {
  readonly key: ExternalMetadataProviderKey;
  readonly label: string;
  /** False for a provider without `/book/{id}`: it is search-only, so stored ids never drive a lookup. */
  readonly identifiable: boolean;
  readonly source = 'external' as const;
  readonly timeoutMs: number;
  readonly mediaKinds: readonly ConcreteBookMediaKind[];
  readonly coverShape?: 'portrait' | 'square';
  readonly iconUrl?: string;
  readonly color?: string;
  readonly cache: ProviderCacheSpec<MetadataSearchParams>;

  private readonly logger: Logger;

  constructor(
    private readonly provider: ActiveHttpProvider,
    private readonly client: HttpProviderClient,
  ) {
    const info = provider.info;
    this.key = provider.key;
    this.label = provider.label;
    this.identifiable = info.lookup;
    this.timeoutMs = provider.target.timeoutMs;
    this.mediaKinds = [...new Set(info.mediaTypes.map((type) => MEDIA_KINDS[type]))];
    this.coverShape = info.coverShape ?? undefined;
    this.iconUrl = provider.iconUrl ?? undefined;
    this.color = provider.color ?? undefined;
    this.logger = new Logger(`HttpMetadataProvider:${provider.key}`);
    this.cache = {
      version: cacheVersion(info),
      trustEmpty: false,
      authoritativeLookupStatuses: [404],
      context: () =>
        Promise.resolve(
          providerCacheContext(true, {
            baseUrl: provider.target.baseUrl,
            authorization: provider.target.authorization ? createHash('sha256').update(provider.target.authorization).digest('hex') : null,
          }),
        ),
      describeSearch: (params) => ({ inputs: Object.fromEntries(this.searchQuery(params)) }),
      describeLookup: (providerId) => ({ inputs: { id: providerId } }),
    };
  }

  bookUrl(id: string): string | undefined {
    return bookUrlFromTemplate(this.provider.info, id);
  }

  async search(params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    if (!params.title && !params.isbn) return [];
    const query = this.searchQuery(params);
    if (!query.has('query') && !query.has('isbn')) return [];
    const body = (await this.call('search', () => this.client.search(this.provider.target, query, params.signal))) as {
      matches?: unknown;
      partial?: unknown;
    } | null;
    if (!body || typeof body !== 'object' || !Array.isArray(body.matches)) {
      throw new HttpProviderError('failed', 'search answer has no matches list');
    }
    if (body.partial === true) markProviderDegraded(`${this.key}.search: provider reported a partial answer`);
    return body.matches.slice(0, MAX_MATCHES).flatMap((match) => {
      const candidate = this.toCandidate(match as SpecBookMetadata);
      return candidate ? [candidate] : [];
    });
  }

  async lookupById(providerId: string, signal?: AbortSignal): Promise<MetadataCandidate | null> {
    if (!this.provider.info.lookup || !providerId || providerId.length > this.provider.info.idMaxLength) return null;
    const body = await this.call('lookup', () => this.client.lookup(this.provider.target, providerId, signal));
    return body ? this.toCandidate(body as SpecBookMetadata) : null;
  }

  private searchQuery(params: MetadataSearchParams): URLSearchParams {
    const supported = new Set(this.provider.info.searchParams);
    const query = new URLSearchParams();
    if (params.title) query.set('query', params.title);
    if (params.author) query.set('author', params.author);
    if (params.isbn && supported.has('isbn')) query.set('isbn', params.isbn);
    query.set('mediaType', params.isAudiobook ? 'audiobook' : 'book');
    if (params.resultsPerProvider && supported.has('limit')) query.set('limit', String(Math.min(params.resultsPerProvider, MAX_MATCHES)));
    return query;
  }

  private async call<T>(op: 'search' | 'lookup', run: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    try {
      const result = await run();
      this.logger.debug(`[http_provider.${op}] [end] provider=${this.key} durationMs=${Date.now() - startedAt} - provider answered`);
      return result;
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[http_provider.${op}] [fail] provider=${this.key} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(message)}" - provider call failed`,
      );
      if (error instanceof HttpProviderError && error.kind === 'throttled') throw new ProviderThrottleError(error.retryAfterSeconds);
      throw error;
    }
  }

  private recordMediaKind(mediaType: unknown): ConcreteBookMediaKind | undefined {
    if (typeof mediaType !== 'string' || !Object.prototype.hasOwnProperty.call(MEDIA_KINDS, mediaType)) return undefined;
    const kind = MEDIA_KINDS[mediaType as keyof typeof MEDIA_KINDS];
    return this.mediaKinds.includes(kind) ? kind : undefined;
  }

  /**
   * Coerces a spec record into a candidate. Types are enforced here because released iOS builds
   * reject a whole search stream when one candidate carries a non-string id or series index.
   */
  private toCandidate(raw: SpecBookMetadata): MetadataCandidate | null {
    if (!raw || typeof raw !== 'object') return null;
    // An id longer than the provider allows is dropped, never cut: a truncated id names another record.
    const rawId = text(raw.providerId, Number.MAX_SAFE_INTEGER) ?? numericId(raw.providerId);
    const providerId = rawId && rawId.length <= this.provider.info.idMaxLength ? rawId : undefined;
    const title = text(raw.title, MAX_TITLE);
    if (!providerId || !title) return null;

    const series = (Array.isArray(raw.series) ? raw.series.slice(0, MAX_LIST) : []).flatMap((entry): MetadataSeriesMembership[] => {
      if (!entry || typeof entry !== 'object') return [];
      const { series: name, sequenceNumber, sequence } = entry as Record<string, unknown>;
      const seriesName = text(name, MAX_ENTRY);
      if (!seriesName) return [];
      const index = parseSeriesIndex(
        typeof sequenceNumber === 'number' ? String(sequenceNumber) : typeof sequence === 'string' ? sequence : undefined,
      );
      return [{ seriesName, ...(index ? { seriesIndex: index } : {}) }];
    });
    const year = integerIn(raw.publishedYear, 1000, 2200);
    const rating = typeof raw.rating === 'number' && Number.isFinite(raw.rating) && raw.rating >= 0 && raw.rating <= 5 ? raw.rating : undefined;
    const ratingCount = integerIn(raw.ratingCount, 0, Number.MAX_SAFE_INTEGER);
    const authors = strings(raw.authors) ?? wrap(text(raw.author, MAX_ENTRY));
    const narrators = strings(raw.narrators) ?? wrap(text(raw.narrator, MAX_ENTRY));
    // The base spec has one `isbn`, which may be either length.
    const isbn = splitMetadataIsbn(text(raw.isbn, 20));

    return {
      provider: this.key,
      providerId,
      title,
      subtitle: text(raw.subtitle, MAX_TITLE),
      authors,
      narrators,
      description: text(raw.description, MAX_DESCRIPTION),
      publisher: text(raw.publisher, MAX_ENTRY),
      publishedDate: isoDate(raw.publishedDate),
      publishedYear: year,
      language: text(raw.languageCode, 35),
      pageCount: integerIn(raw.pages, 1, 100_000),
      isbn13: text(raw.isbn13, 20) ?? isbn.isbn13,
      isbn10: text(raw.isbn10, 20) ?? isbn.isbn10,
      genres: strings(raw.genres),
      coverUrl: httpUrl(raw.cover) ?? undefined,
      coverWidth: integerIn(raw.coverWidth, 1, 20_000),
      coverHeight: integerIn(raw.coverHeight, 1, 20_000),
      sourceUrl: httpUrl(raw.url) ?? this.bookUrl(providerId),
      seriesName: series[0]?.seriesName,
      seriesIndex: series[0]?.seriesIndex ?? undefined,
      seriesMemberships: series.length > 0 ? series : undefined,
      durationSeconds: integerIn(raw.duration, 1, 10_000_000),
      communityRating: rating,
      communityRatingCount: rating !== undefined ? ratingCount : undefined,
      // Only a medium the provider declared counts: a record cannot claim one its provider never serves.
      mediaKind: this.recordMediaKind(raw.mediaType),
      ...(this.coverShape ? { coverShape: this.coverShape } : {}),
    };
  }
}

/**
 * The provider's own version is part of the key, so a provider release stops old answers being
 * served, and so is every info field the mapping above reads, so changing one does too.
 */
function cacheVersion(info: MetadataHttpProviderInfo): number {
  const digest = createHash('sha256')
    .update(JSON.stringify([MAPPING_VERSION, info.specVersion, info.version, info.idMaxLength, info.bookUrlTemplate, info.coverShape]))
    .digest('hex');
  return Number.parseInt(digest.slice(0, 7), 16);
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function numericId(value: unknown): string | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : undefined;
}

function strings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = [...new Set(value.slice(0, MAX_LIST).flatMap((item) => wrap(text(item, MAX_ENTRY)) ?? []))];
  return out.length > 0 ? out : undefined;
}

function wrap(value: string | undefined): string[] | undefined {
  return value ? [value] : undefined;
}

function integerIn(value: unknown, min: number, max: number): number | undefined {
  const number = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
  return typeof number === 'number' && Number.isInteger(number) && number >= min && number <= max ? number : undefined;
}

function isoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return undefined;
  return Number.isNaN(Date.parse(value)) ? undefined : value.trim();
}
