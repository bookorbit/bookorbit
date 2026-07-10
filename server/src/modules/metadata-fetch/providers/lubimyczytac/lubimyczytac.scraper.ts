import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';

import { parsePublishedDateKey, parsePublishedYear, publishedYearFromDateKey } from '../../../../common/utils/published-date.utils';

export interface LubimyczytacSearchResultLink {
  providerId: string;
  url: string;
}

export interface LubimyczytacBookData {
  providerId?: string;
  title?: string;
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

const LUBIMYCZYTAC_BASE_URL = 'https://lubimyczytac.pl';
const LUBIMYCZYTAC_SEARCH_PATH = '/szukaj/ksiazki';
const BOOK_PATH_PATTERN = /\/ksiazka\/(\d+(?:\/[^/?#]+)?)/;
const SERIES_INDEX_PATTERN = /\(tom\s+(\d+(?:[.,]\d+)?)\)/i;
const MAX_GENRES = 10;

const LANGUAGE_MAP: Record<string, string> = {
  polski: 'pl',
  angielski: 'en',
  niemiecki: 'de',
  francuski: 'fr',
  hiszpański: 'es',
  włoski: 'it',
};

export function buildLubimyczytacSearchUrl(query: string, author?: string): string {
  const url = new URL(LUBIMYCZYTAC_SEARCH_PATH, LUBIMYCZYTAC_BASE_URL);
  url.searchParams.set('phrase', query);
  if (author?.trim()) url.searchParams.set('author', author.trim());
  return url.toString();
}

export function buildLubimyczytacBookUrl(providerId: string): string {
  const path = extractLubimyczytacPath(providerId) ?? providerId.trim().replace(/^\/+|\/+$/g, '');
  const segments = path.split('/').filter(Boolean);
  // A bare numeric id (no slug) 404s; lubimyczytac.pl serves the book for any non-empty slug segment.
  if (segments.length === 1) segments.push('-');
  return `${LUBIMYCZYTAC_BASE_URL}/ksiazka/${segments.map(encodeURIComponent).join('/')}`;
}

// Canonical path after /ksiazka/, e.g. "123456/some-slug" (or just the numeric id when no slug is present).
export function extractLubimyczytacPath(value: string): string | undefined {
  const match = BOOK_PATH_PATTERN.exec(value);
  if (match) return match[1];
  const trimmed = value.trim().replace(/^\/+|\/+$/g, '');
  return /^\d+(?:\/[^/?#]+)?$/.test(trimmed) ? trimmed : undefined;
}

// Numeric book id only - used for de-duplication and validation.
export function extractLubimyczytacId(value: string): string | undefined {
  const id = extractLubimyczytacPath(value)?.split('/')[0];
  return id && /^\d+$/.test(id) ? id : undefined;
}

export function extractLubimyczytacSearchResults(html: string, limit: number): LubimyczytacSearchResultLink[] {
  const $ = cheerio.load(html);
  const results: LubimyczytacSearchResultLink[] = [];
  const seen = new Set<string>();

  const anchors = [...$('a.book-card__title').toArray(), ...$('.authorAllBooks__single .authorAllBooks__singleTextTitle').toArray()];

  for (const el of anchors) {
    if (results.length >= limit) break;
    const href = $(el).attr('href');
    if (!href) continue;
    const id = extractLubimyczytacId(href);
    const providerId = extractLubimyczytacPath(href);
    if (!id || !providerId || seen.has(id)) continue;
    seen.add(id);
    results.push({ providerId, url: resolveUrl(href) });
  }

  return results;
}

export function parseLubimyczytacBookPage(html: string, sourceUrl?: string): LubimyczytacBookData {
  const $ = cheerio.load(html);
  const jsonLd = parseJsonLd($);
  const canonicalPath = jsonLd.url ? extractLubimyczytacPath(jsonLd.url) : undefined;
  const sourcePath = sourceUrl ? extractLubimyczytacPath(sourceUrl) : undefined;
  const { isbn10, isbn13 } = extractIsbn($);
  const series = extractSeries($);

  return {
    providerId: canonicalPath ?? sourcePath,
    title: extractTitle($),
    authors: jsonLd.authors?.length ? jsonLd.authors : extractAuthors($),
    description: extractDescription($),
    publisher: extractPublisher($),
    publishedDate: jsonLd.publishedDate,
    publishedYear: jsonLd.publishedYear,
    language: extractLanguage($) ?? (jsonLd.language ? mapLanguage(jsonLd.language) : undefined),
    pageCount: jsonLd.pageCount,
    isbn10,
    isbn13,
    seriesName: series.name,
    seriesIndex: series.index,
    genres: extractGenres($, jsonLd.genre),
    coverUrl: extractCoverUrl($),
    sourceUrl,
  };
}

function extractTitle($: CheerioAPI): string | undefined {
  return cleanText($('h1.book__title').first().text()) || undefined;
}

function extractAuthors($: CheerioAPI): string[] {
  const authors: string[] = [];
  const seen = new Set<string>();
  $('a.link-name[href*="/autor/"], a[href*="/autor/"]').each((_, el) => {
    const name = cleanText($(el).text());
    if (!name || seen.has(name)) return;
    seen.add(name);
    authors.push(name);
  });
  return authors;
}

function extractDescription($: CheerioAPI): string | undefined {
  // `.book__description` is the actual blurb; avoid `.collapse-content`, which the page also uses
  // for user reviews and the ratings histogram.
  return cleanText($('.book__description').first().text()) || cleanText($('meta[property="og:description"]').attr('content')) || undefined;
}

function extractPublisher($: CheerioAPI): string | undefined {
  return cleanText($('a[href*="/wydawnictwo/"]').first().text()) || undefined;
}

function extractLanguage($: CheerioAPI): string | undefined {
  let raw = '';
  $('dt').each((_, el) => {
    if (raw) return;
    if (/język/i.test($(el).text())) raw = cleanText($(el).next('dd').text());
  });
  return raw ? mapLanguage(raw) : undefined;
}

function mapLanguage(raw: string): string {
  const normalized = raw.trim().toLowerCase();
  return LANGUAGE_MAP[normalized] ?? normalized;
}

function extractIsbn($: CheerioAPI): { isbn10?: string; isbn13?: string } {
  const raw = cleanText($('meta[property="books:isbn"]').attr('content'));
  const normalized = raw.replace(/[^0-9X]/gi, '').toUpperCase();
  if (normalized.length === 13) return { isbn13: normalized };
  if (normalized.length === 10) return { isbn10: normalized };
  return {};
}

function extractSeries($: CheerioAPI): { name?: string; index?: number } {
  let raw = '';
  $('span.d-none.d-sm-block.mt-1').each((_, el) => {
    if (raw) return;
    const text = cleanText($(el).text());
    if (text.startsWith('Cykl:')) raw = text;
  });
  if (!raw) return {};

  const text = raw.slice('Cykl:'.length).trim();

  // Preferred format: "Series Name (tom 4)"
  const tomMatch = SERIES_INDEX_PATTERN.exec(text);
  if (tomMatch) {
    const index = parseFloat(tomMatch[1].replace(',', '.'));
    return { name: text.replace(SERIES_INDEX_PATTERN, '').trim() || undefined, index: Number.isNaN(index) ? undefined : index };
  }

  // Fallback: "Series Name 4" (trailing standalone volume number)
  const trailing = /\s(\d+(?:[.,]\d+)?)$/.exec(text);
  if (trailing) {
    const index = parseFloat(trailing[1].replace(',', '.'));
    return { name: text.slice(0, trailing.index).trim() || undefined, index: Number.isNaN(index) ? undefined : index };
  }

  return { name: text || undefined };
}

function extractGenres($: CheerioAPI, jsonLdGenre?: string): string[] {
  const genres: string[] = [];
  const seen = new Set<string>();
  const add = (value: string | undefined) => {
    const genre = cleanText(value);
    if (!genre || seen.has(genre) || genres.length >= MAX_GENRES) return;
    seen.add(genre);
    genres.push(genre);
  };

  // Category breadcrumb, e.g. "Literatura obyczajowa, romans" -> split into individual genres
  $('a.book__category').each((_, el) => {
    for (const part of $(el).text().split(',')) add(part);
  });
  // User tags (older layout / when present)
  $('a[href*="/ksiazki/t/"]').each((_, el) => add($(el).text()));
  if (!genres.length && jsonLdGenre) add(deslugify(jsonLdGenre));
  return genres;
}

function extractCoverUrl($: CheerioAPI): string | undefined {
  const raw = $('.book-cover img').first().attr('src') || $('meta[property="og:image"]').attr('content');
  if (!raw) return undefined;
  return resolveUrl(raw);
}

type JsonLdFields = {
  authors?: string[];
  publishedDate?: string;
  publishedYear?: number;
  pageCount?: number;
  genre?: string;
  language?: string;
  url?: string;
};

function parseJsonLd($: CheerioAPI): JsonLdFields {
  const fields: JsonLdFields = {};

  $('script[type="application/ld+json"]').each((_, el) => {
    const node = findBookNode(safeJsonParse($(el).contents().text()));
    if (!node) return;

    if (!fields.authors) {
      const authors = parseJsonLdAuthors(node.author);
      if (authors.length) fields.authors = authors;
    }
    if (fields.pageCount === undefined) {
      const pages = parseInteger(node.numberOfPages);
      if (pages !== undefined) fields.pageCount = pages;
    }
    if (fields.publishedYear === undefined) {
      const publishedDate = parsePublishedDateKey(node.datePublished);
      if (publishedDate !== undefined) {
        fields.publishedDate = publishedDate;
        fields.publishedYear = publishedYearFromDateKey(publishedDate);
      } else {
        const year = parseYear(node.datePublished);
        if (year !== undefined) fields.publishedYear = year;
      }
    }
    if (!fields.genre && typeof node.genre === 'string') {
      fields.genre = node.genre.split('/').filter(Boolean).pop();
    }
    if (!fields.language && typeof node.inLanguage === 'string') {
      fields.language = node.inLanguage;
    }
    if (!fields.url && typeof node.url === 'string') {
      fields.url = node.url;
    }
  });

  return fields;
}

type JsonLdNode = {
  author?: unknown;
  numberOfPages?: unknown;
  datePublished?: unknown;
  genre?: unknown;
  inLanguage?: unknown;
  url?: unknown;
};

function findBookNode(value: unknown): JsonLdNode | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findBookNode(item);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const node = value as Record<string, unknown>;
  if ('@graph' in node) return findBookNode(node['@graph']);
  const type = node['@type'];
  if (type === 'Book' || type === 'Audiobook') return node as JsonLdNode;
  if ('author' in node || 'numberOfPages' in node || 'datePublished' in node || 'genre' in node) return node as JsonLdNode;
  return undefined;
}

function parseJsonLdAuthors(author: unknown): string[] {
  const names: string[] = [];
  const push = (entry: unknown) => {
    if (typeof entry === 'string') {
      const name = cleanText(entry);
      if (name) names.push(name);
      return;
    }
    if (typeof entry === 'object' && entry !== null && 'name' in entry) {
      const rawName = (entry as { name?: unknown }).name;
      if (typeof rawName === 'string') {
        const name = cleanText(rawName);
        if (name) names.push(name);
      }
    }
  };

  if (Array.isArray(author)) author.forEach(push);
  else push(author);
  return names;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function resolveUrl(value: string): string {
  if (value.startsWith('//')) return `https:${value}`;
  return new URL(value, LUBIMYCZYTAC_BASE_URL).toString();
}

function cleanText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function deslugify(value: string): string {
  return value.replace(/[-_]+/g, ' ').trim();
}

function parseInteger(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : undefined;
  if (typeof value !== 'string') return undefined;
  const match = value.replace(/,/g, '').match(/\d+/);
  if (!match) return undefined;
  const parsed = parseInt(match[0], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseYear(value: unknown): number | undefined {
  return parsePublishedYear(typeof value === 'string' ? value : undefined);
}
