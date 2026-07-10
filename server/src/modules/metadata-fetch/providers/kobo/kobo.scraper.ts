import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';

import { parsePublishedDateKey, parsePublishedYear, publishedYearFromDateKey } from '../../../../common/utils/published-date.utils';

export interface KoboRegionConfig {
  country: string;
  language: string;
}

export interface KoboSearchResultLink {
  providerId: string;
  url: string;
}

export interface KoboBookData {
  providerId?: string;
  title?: string;
  subtitle?: string;
  authors?: string[];
  description?: string;
  publisher?: string;
  publishedDate?: string;
  publishedYear?: number;
  language?: string;
  pageCount?: number;
  isbn10?: string;
  isbn13?: string;
  seriesName?: string;
  seriesIndex?: number;
  genres?: string[];
  coverUrl?: string;
  sourceUrl?: string;
}

type KoboDetails = {
  publisher?: string;
  publishedDate?: string;
  publishedYear?: number;
  language?: string;
  pageCount?: number;
  isbn10?: string;
  isbn13?: string;
  providerId?: string;
  bookId?: string;
};

type ChallengeResponse = {
  status?: number;
  headers?: {
    get(name: string): string | null;
  };
};

const KOBO_BASE_URL = 'https://www.kobo.com';
const CHALLENGE_PATTERNS = [/challenge-form/i, /challenge-error-text/i, /cf-chl/i, /cf_chl/i, /<title>\s*Challenged\s*\|\s*Kobo\.com\s*<\/title>/i];

export function buildKoboSearchUrl(query: string, page: number, config: KoboRegionConfig): string {
  const country = normalizeKoboPathSegment(config.country, 'us');
  const language = normalizeKoboPathSegment(config.language, 'en');
  const pageNumber = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const url = new URL(`/${country}/${language}/search`, KOBO_BASE_URL);
  url.searchParams.set('query', query);
  url.searchParams.set('fcmedia', 'Book');
  url.searchParams.set('pageNumber', String(pageNumber));
  url.searchParams.set('fclanguages', language);
  return url.toString();
}

export function buildKoboBookUrl(providerId: string, config: KoboRegionConfig): string {
  const country = normalizeKoboPathSegment(config.country, 'us');
  const language = normalizeKoboPathSegment(config.language, 'en');
  const id = normalizeKoboProviderId(providerId);
  const path = language === 'all' ? `/${country}/ebook/${encodeURIComponent(id)}` : `/${country}/${language}/ebook/${encodeURIComponent(id)}`;
  return new URL(path, KOBO_BASE_URL).toString();
}

export function extractKoboSearchResults(html: string, limit: number): KoboSearchResultLink[] {
  const $ = cheerio.load(html);
  const results: KoboSearchResultLink[] = [];
  const seen = new Set<string>();
  const anchors = [
    ...$('div[data-testid="search-result-widget"] a[data-testid="title"]').toArray(),
    ...$('h2.title.product-field a').toArray(),
    ...$('[data-testid="search-result-widget"] a[href*="/ebook/"]').toArray(),
  ];

  for (const el of anchors) {
    if (results.length >= limit) break;
    const href = $(el).attr('href');
    const providerId = href ? extractKoboProviderId(href) : undefined;
    if (!href || !providerId || seen.has(providerId)) continue;
    seen.add(providerId);
    results.push({ providerId, url: resolveKoboUrl(href) });
  }

  return results;
}

export function parseKoboBookPage(html: string, sourceUrl?: string): KoboBookData {
  const $ = cheerio.load(html);
  const { title, subtitle } = extractTitle($);
  const details = extractDetails($);
  const sourceProviderId = sourceUrl ? extractKoboProviderId(sourceUrl) : undefined;
  const bookId = details.bookId ? normalizeIsbn(details.bookId) || details.bookId : undefined;

  return {
    providerId: sourceProviderId ?? details.providerId ?? bookId,
    title,
    subtitle,
    authors: extractAuthors($),
    description: extractDescription($),
    publisher: details.publisher,
    publishedDate: details.publishedDate,
    publishedYear: details.publishedYear,
    language: details.language,
    pageCount: details.pageCount ?? extractPageCount($),
    isbn10: details.isbn10,
    isbn13: details.isbn13,
    seriesName: extractSeriesName($),
    seriesIndex: extractSeriesIndex($),
    genres: extractGenres($),
    coverUrl: extractCoverUrl($),
    sourceUrl,
  };
}

export function extractKoboProviderId(value: string): string | undefined {
  const raw = value.trim();
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw, KOBO_BASE_URL);
  } catch {
    const fallbackSlug = raw.split('/ebook/').pop()?.split(/[?#/]/)[0];
    return fallbackSlug ? normalizeKoboProviderId(fallbackSlug) || undefined : undefined;
  }

  const marker = '/ebook/';
  const index = url.pathname.indexOf(marker);
  if (index === -1) return undefined;
  const remainder = url.pathname.slice(index + marker.length);
  const slug = remainder.split('/')[0];
  return normalizeKoboProviderId(decodeURIComponent(slug)) || undefined;
}

export function normalizeKoboProviderId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const fromUrl = trimmed.includes('/ebook/') ? extractKoboProviderId(trimmed) : undefined;
  const raw = fromUrl ?? trimmed;
  return (
    raw
      .split(/[?#]/)[0]
      ?.replace(/^\/+|\/+$/g, '')
      .trim() ?? ''
  );
}

export function isKoboProductUrl(url: string): boolean {
  try {
    return new URL(url, KOBO_BASE_URL).pathname.includes('/ebook/');
  } catch {
    return false;
  }
}

export function isKoboChallengePage(html: string, response?: ChallengeResponse): boolean {
  const cfMitigated = response?.headers?.get('cf-mitigated')?.toLowerCase() === 'challenge';
  if (cfMitigated) return true;
  if (response?.status === 403 && /cloudflare/i.test(html)) return true;
  return CHALLENGE_PATTERNS.some((pattern) => pattern.test(html));
}

function extractTitle($: CheerioAPI): { title?: string; subtitle?: string } {
  const explicitSubtitle =
    cleanText($('span.subtitle.product-field').first().text()) ||
    cleanText($('[data-testid="subtitle"]').first().text()) ||
    cleanText($('meta[property="book:subtitle"]').attr('content'));
  const raw =
    cleanText($('h1.title.product-field').first().text()) ||
    cleanText($('h1[data-testid="title"]').first().text()) ||
    cleanText($('meta[property="og:title"]').attr('content')) ||
    cleanText($('h1').first().text());
  if (!raw) return {};

  const normalized = raw.replace(/\s+eBook\s+by\s+.+$/i, '').trim();
  const colon = normalized.indexOf(':');
  if (colon > 0) {
    return {
      title: normalized.slice(0, colon).trim(),
      subtitle: explicitSubtitle || normalized.slice(colon + 1).trim() || undefined,
    };
  }
  return { title: normalized, subtitle: explicitSubtitle || undefined };
}

function extractAuthors($: CheerioAPI): string[] {
  const authors: string[] = [];
  const seen = new Set<string>();
  const selectors = ['span.visible-contributors a', '[data-testid="contributors"] a', 'a[href*="/author/"]'];

  for (const selector of selectors) {
    $(selector).each((_, el) => {
      const name = cleanText($(el).text());
      if (!name || seen.has(name)) return;
      seen.add(name);
      authors.push(name);
    });
    if (authors.length) break;
  }

  return authors;
}

function extractDescription($: CheerioAPI): string | undefined {
  const synopsis = $('[data-full-synopsis]').first();
  const full = cleanText(synopsis.attr('data-full-synopsis'));
  if (full) return full;

  const synopsisText = cleanText(synopsis.text());
  if (synopsisText) return synopsisText;

  const fallback =
    cleanText($('[itemprop="description"]').first().text()) ||
    cleanText($('meta[name="description"]').attr('content')) ||
    cleanText($('meta[property="og:description"]').attr('content'));
  return fallback || undefined;
}

function extractSeriesName($: CheerioAPI): string | undefined {
  const series = $('span.series.product-field').last();
  const name =
    cleanText(series.find('span.product-sequence-field a').first().text()) ||
    cleanText($('[data-testid="series"] a').first().text()) ||
    cleanText($('[data-testid="series"]').first().text());
  return name || undefined;
}

function extractSeriesIndex($: CheerioAPI): number | undefined {
  const raw =
    cleanText($('span.series.product-field').last().find('span.sequenced-name-prefix').first().text()) ||
    cleanText($('[data-testid="series"]').first().text());
  const match = raw.match(/Book\s+(\d+(?:\.\d+)?)\s*-/i) ?? raw.match(/#\s*(\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  const value = parseFloat(match[1]);
  return Number.isNaN(value) ? undefined : value;
}

function extractDetails($: CheerioAPI): KoboDetails {
  const details: KoboDetails = {};
  const items = $('div.bookitem-secondary-metadata ul li').toArray();
  if (!items.length) return details;

  const firstText = cleanText($(items[0]).text());
  if (firstText && !/^(release date|isbn|book id|language|publisher):/i.test(firstText)) {
    details.publisher = firstText;
  }

  for (const item of items) {
    const label = cleanText($(item).clone().children().remove().end().text()).replace(/:$/, '');
    const spanValue = cleanText($(item).find('span').first().text());
    const inlineValue = cleanText($(item).text()).replace(new RegExp(`^${escapeRegExp(label)}:?\\s*`, 'i'), '');
    const value = spanValue || inlineValue;
    if (!label || !value) continue;

    if (/^release date$/i.test(label)) {
      const publishedDate = parsePublishedDateKey(value);
      details.publishedDate = publishedDate;
      details.publishedYear = publishedDate ? publishedYearFromDateKey(publishedDate) : parseYearFromText(value);
    } else if (/^pages$/i.test(label)) {
      details.pageCount = parseIntegerFromText(value);
    } else if (/^(isbn|book id)$/i.test(label)) {
      const normalized = normalizeIsbn(value);
      if (normalized?.length === 13) details.isbn13 = normalized;
      else if (normalized?.length === 10) details.isbn10 = normalized;
      else if (/^book id$/i.test(label)) details.bookId = value;
    } else if (/^language$/i.test(label)) {
      details.language = value;
    } else if (/^publisher$/i.test(label)) {
      details.publisher = value;
    }
  }

  return details;
}

function extractPageCount($: CheerioAPI): number | undefined {
  for (const column of $('#about-this-book-widget .book-stats .column').toArray()) {
    const label = cleanText($(column).find('span').first().text());
    if (!/^pages$/i.test(label)) continue;
    return parseIntegerFromText(cleanText($(column).find('strong').first().text()));
  }

  const configuredPageCount = extractConfiguredGoogleBookPageCount($);
  if (configuredPageCount !== undefined) return configuredPageCount;

  return parseIntegerFromText(cleanText($('meta[property="books:page_count"], meta[name="pageCount"]').attr('content')));
}

function extractGenres($: CheerioAPI): string[] {
  const genres: string[] = [];
  const seen = new Set<string>();
  const add = (value: string | undefined) => {
    const genre = cleanText(value);
    if (!genre || seen.has(genre)) return;
    seen.add(genre);
    genres.push(genre);
  };

  $('ul.category-rankings meta[property="genre"], meta[property="book:genre"], meta[property="genre"]').each((_, el) => add($(el).attr('content')));
  return genres;
}

function extractCoverUrl($: CheerioAPI): string | undefined {
  const raw =
    $('img.cover-image').first().attr('src') ||
    $('img[class*="cover-image"]').first().attr('src') ||
    $('meta[property="og:image"]').attr('content') ||
    $('link[rel="image_src"]').attr('href');
  if (!raw) return undefined;
  return normalizeKoboCoverUrl(resolveKoboUrl(raw));
}

function normalizeKoboCoverUrl(url: string): string {
  return url.replace(/\/book-images\/([^/]+)\/\d+\/\d+\/\d+\/(False|false)\//, '/book-images/$1/1650/2200/100/$2/');
}

function resolveKoboUrl(value: string): string {
  if (value.startsWith('//')) return `https:${value}`;
  return new URL(value, KOBO_BASE_URL).toString();
}

function normalizeKoboPathSegment(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
  return normalized || fallback;
}

function cleanText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeIsbn(value: string): string | undefined {
  const normalized = value.replace(/[^0-9X]/gi, '').toUpperCase();
  return normalized || undefined;
}

function parseYearFromText(text: string): number | undefined {
  return parsePublishedYear(text);
}

function parseIntegerFromText(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const match = text.replace(/,/g, '').match(/\d+/);
  if (!match) return undefined;
  const value = parseInt(match[0], 10);
  return Number.isFinite(value) ? value : undefined;
}

function extractConfiguredGoogleBookPageCount($: CheerioAPI): number | undefined {
  const rawConfig = $('#ratings-widget-details-wrapper').attr('data-kobo-gizmo-config');
  if (!rawConfig) return undefined;

  try {
    const config = JSON.parse(rawConfig) as { googleBook?: string };
    if (!config.googleBook) return undefined;
    const book = JSON.parse(config.googleBook) as { numberOfPages?: unknown };
    if (typeof book.numberOfPages === 'number') return book.numberOfPages;
    if (typeof book.numberOfPages === 'string') return parseIntegerFromText(book.numberOfPages);
    return undefined;
  } catch {
    return undefined;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
