import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  AUDIOBOOK_CHAPTER_LIMITS,
  BOOK_CHAPTERS_ERROR_CODES,
  type AudibleRegion,
  type ChapterLookupNode,
  type ChapterLookupResult,
} from '@bookorbit/types';

import { readBoundedText } from '../../common/utils/bounded-response';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { normalizeAudibleDomain } from '../../common/utils/metadata-provider-hosts.utils';

const AUDIBLE_API_ORIGIN_BY_REGION: Readonly<Record<AudibleRegion, string>> = {
  us: 'https://api.audible.com',
  uk: 'https://api.audible.co.uk',
  ca: 'https://api.audible.ca',
  au: 'https://api.audible.com.au',
  de: 'https://api.audible.de',
  fr: 'https://api.audible.fr',
  it: 'https://api.audible.it',
  es: 'https://api.audible.es',
  jp: 'https://api.audible.co.jp',
  in: 'https://api.audible.in',
};

const REGION_BY_AUDIBLE_DOMAIN: Readonly<Record<string, AudibleRegion>> = {
  com: 'us',
  'co.uk': 'uk',
  ca: 'ca',
  'com.au': 'au',
  de: 'de',
  fr: 'fr',
  it: 'it',
  es: 'es',
  'co.jp': 'jp',
  in: 'in',
};

const AUDNEXUS_ORIGIN = 'https://api.audnex.us';
const LOOKUP_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
// Parts nest chapters, and a few books nest once more; anything deeper is not a chapter list.
const MAX_DEPTH = 3;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_ENTRIES = 200;

type Answer = { kind: 'found'; result: ChapterLookupResult } | { kind: 'missing' } | { kind: 'unavailable'; reason: string };

/** The storefront an Audible provider domain setting points at, in any of the forms the setting accepts (`co.uk`, `audible.co.uk`). */
export function audibleRegionForDomain(domain: string | null | undefined): AudibleRegion {
  return REGION_BY_AUDIBLE_DOMAIN[normalizeAudibleDomain(domain)] ?? 'us';
}

/**
 * Chapter timings for an Audible release, asked of Audible's own catalogue first (it keeps parts
 * nested and answers for every storefront) and of Audnexus when Audible does not answer. Both are
 * fixed hosts; the only caller-controlled parts of the URL are a validated ASIN and a whitelisted
 * region. Answers are kept for a few hours, since chapter timings for a release do not change.
 */
@Injectable()
export class ChapterLookupService {
  private readonly logger = new Logger(ChapterLookupService.name);
  private readonly cache = new Map<string, { storedAt: number; result: ChapterLookupResult }>();

  async lookup(asin: string, region: AudibleRegion): Promise<ChapterLookupResult> {
    const key = `${region}:${asin}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.storedAt < CACHE_TTL_MS) return cached.result;

    const audible = await this.ask('audible', asin, region);
    const answer = audible.kind === 'found' ? audible : await this.ask('audnexus', asin, region);
    if (answer.kind === 'found') {
      this.remember(key, answer.result);
      return answer.result;
    }
    if (audible.kind === 'unavailable' || answer.kind === 'unavailable') {
      throw new HttpException(
        { message: 'The chapter sources could not be reached', errorCode: BOOK_CHAPTERS_ERROR_CODES.lookupUnavailable },
        HttpStatus.BAD_GATEWAY,
      );
    }
    throw new HttpException(
      { message: 'No chapters were found for that ASIN', errorCode: BOOK_CHAPTERS_ERROR_CODES.lookupNotFound },
      HttpStatus.NOT_FOUND,
    );
  }

  private async ask(provider: ChapterLookupResult['provider'], asin: string, region: AudibleRegion): Promise<Answer> {
    const event = 'chapter_lookup.fetch';
    const startedAt = Date.now();
    const url =
      provider === 'audible'
        ? `${AUDIBLE_API_ORIGIN_BY_REGION[region]}/1.0/content/${encodeURIComponent(asin)}/metadata?response_groups=chapter_info&chapter_titles_type=Tree`
        : `${AUDNEXUS_ORIGIN}/books/${encodeURIComponent(asin)}/chapters?region=${region}`;
    this.logger.log(`[${event}] [start] provider=${provider} asin=${asin} region=${region} - chapter lookup started`);
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      });
      if (!response.ok) await response.body?.cancel().catch(() => undefined);
      if (response.status === 404 || response.status === 400) {
        this.logger.log(
          `[${event}] [end] provider=${provider} asin=${asin} status=${response.status} durationMs=${Date.now() - startedAt} - no chapters`,
        );
        return { kind: 'missing' };
      }
      if (!response.ok) {
        this.logger.warn(
          `[${event}] [fail] provider=${provider} asin=${asin} status=${response.status} durationMs=${Date.now() - startedAt} - lookup refused`,
        );
        return { kind: 'unavailable', reason: `status ${response.status}` };
      }
      const body: unknown = JSON.parse(await readBoundedText(response, MAX_RESPONSE_BYTES));
      const result = provider === 'audible' ? parseAudible(body, asin, region) : parseAudnexus(body, asin, region);
      this.logger.log(
        `[${event}] [end] provider=${provider} asin=${asin} durationMs=${Date.now() - startedAt} chapters=${result?.chapters.length ?? 0} - chapter lookup finished`,
      );
      return result ? { kind: 'found', result } : { kind: 'missing' };
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'Error';
      const message = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[${event}] [fail] provider=${provider} asin=${asin} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${message}" - lookup failed`,
      );
      return { kind: 'unavailable', reason: errorClass };
    }
  }

  private remember(key: string, result: ChapterLookupResult): void {
    if (this.cache.size >= CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { storedAt: Date.now(), result });
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function wholeMs(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

/** Shared walk for both shapes, bounded in depth and in total chapters. */
function mapNodes(
  raw: unknown,
  read: (entry: Record<string, unknown>) => { title: unknown; startMs: unknown; lengthMs: unknown; children: unknown },
  budget: { remaining: number; truncated: boolean },
  depth = 0,
): ChapterLookupNode[] {
  if (!Array.isArray(raw)) return [];
  if (depth > MAX_DEPTH) {
    budget.truncated ||= raw.length > 0;
    return [];
  }
  const nodes: ChapterLookupNode[] = [];
  for (const item of raw) {
    if (budget.remaining <= 0) {
      budget.truncated = true;
      break;
    }
    const entry = read(record(item));
    const startMs = wholeMs(entry.startMs);
    if (startMs === null) continue;
    budget.remaining -= 1;
    const title = typeof entry.title === 'string' ? entry.title.trim().slice(0, AUDIOBOOK_CHAPTER_LIMITS.maxTitleLength) : '';
    nodes.push({ title, startMs, lengthMs: wholeMs(entry.lengthMs), children: mapNodes(entry.children, read, budget, depth + 1) });
  }
  return nodes;
}

function parseAudible(body: unknown, asin: string, region: AudibleRegion): ChapterLookupResult | null {
  const info = record(record(record(body).content_metadata).chapter_info);
  const budget = { remaining: AUDIOBOOK_CHAPTER_LIMITS.maxChapters, truncated: false };
  const chapters = mapNodes(
    info.chapters,
    (entry) => ({ title: entry.title, startMs: entry.start_offset_ms, lengthMs: entry.length_ms, children: entry.chapters }),
    budget,
  );
  if (chapters.length === 0) return null;
  return {
    provider: 'audible',
    asin,
    region,
    chapters,
    ...(budget.truncated ? { truncated: true } : {}),
    runtimeMs: wholeMs(info.runtime_length_ms),
    brandIntroMs: wholeMs(info.brandIntroDurationMs) ?? 0,
    brandOutroMs: wholeMs(info.brandOutroDurationMs) ?? 0,
    isAccurate: typeof info.is_accurate === 'boolean' ? info.is_accurate : null,
  };
}

function parseAudnexus(body: unknown, asin: string, region: AudibleRegion): ChapterLookupResult | null {
  const data = record(body);
  const budget = { remaining: AUDIOBOOK_CHAPTER_LIMITS.maxChapters, truncated: false };
  const chapters = mapNodes(
    data.chapters,
    (entry) => ({ title: entry.title, startMs: entry.startOffsetMs, lengthMs: entry.lengthMs, children: undefined }),
    budget,
  );
  if (chapters.length === 0) return null;
  return {
    provider: 'audnexus',
    asin,
    region,
    chapters,
    ...(budget.truncated ? { truncated: true } : {}),
    runtimeMs: wholeMs(data.runtimeLengthMs),
    brandIntroMs: wholeMs(data.brandIntroDurationMs) ?? 0,
    brandOutroMs: wholeMs(data.brandOutroDurationMs) ?? 0,
    isAccurate: typeof data.isAccurate === 'boolean' ? data.isAccurate : null,
  };
}
