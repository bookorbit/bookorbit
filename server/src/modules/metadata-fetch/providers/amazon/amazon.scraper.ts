import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';

export interface AmazonBookData {
  title?: string;
  subtitle?: string;
  authors?: string[];
  description?: string;
  isbn13?: string;
  isbn10?: string;
  publisher?: string;
  publishedYear?: number;
  language?: string;
  pageCount?: number;
  seriesName?: string;
  seriesIndex?: number;
  coverUrl?: string;
  tags?: string[];
}

const SKIP_TITLE_PATTERNS = /box\s*set|collection\s*set|books\s*set|omnibus|summary\s*&\s*study/i;

export function parseBookPage(html: string): AmazonBookData {
  const $ = cheerio.load(html);
  const { title, subtitle } = extractTitle($);
  return {
    title,
    subtitle,
    authors: extractAuthors($),
    description: extractDescription($),
    isbn13: extractIsbn($, 'isbn13'),
    isbn10: extractIsbn($, 'isbn10'),
    publisher: extractPublisher($),
    publishedYear: extractPublishedYear($),
    language: extractLanguage($),
    pageCount: extractPageCount($),
    seriesName: extractSeriesName($),
    seriesIndex: extractSeriesIndex($),
    coverUrl: extractCoverUrl($),
    tags: extractCategories($),
  };
}

export function extractAsins(html: string, limit: number): string[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const asins: string[] = [];

  $('div[data-asin]').each((_, el) => {
    const asin = $(el).attr('data-asin');
    if (!asin || asin.length !== 10 || seen.has(asin)) return;
    const titleText = $(el).find('[data-cy=title-recipe]').text().toLowerCase();
    if (SKIP_TITLE_PATTERNS.test(titleText)) return;
    seen.add(asin);
    asins.push(asin);
    if (asins.length >= limit) return false;
  });

  return asins;
}

// --- Field extractors ---

function extractTitle($: CheerioAPI): { title?: string; subtitle?: string } {
  const raw = $('#productTitle, #ebooksProductTitle').first().text().trim();
  if (!raw) return {};
  const colon = raw.indexOf(':');
  if (colon > 0) {
    return { title: raw.substring(0, colon).trim(), subtitle: raw.substring(colon + 1).trim() };
  }
  return { title: raw };
}

function extractAuthors($: CheerioAPI): string[] {
  const authors: string[] = [];
  const seen = new Set<string>();
  $('#bylineInfo .author a, #bylineInfo_feature_div .author a').each((_, el) => {
    const name = $(el).text().trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      authors.push(name);
    }
  });
  return authors;
}

function extractDescription($: CheerioAPI): string | undefined {
  const expander = $('#bookDescription_feature_div .a-expander-content').first();
  if (expander.length) return expander.text().trim() || undefined;

  const noscript = $('#bookDescription_feature_div noscript').first();
  if (noscript.length) {
    const inner = cheerio.load(noscript.html() ?? '');
    return inner.root().text().trim() || undefined;
  }
  return undefined;
}

function extractIsbn($: CheerioAPI, field: 'isbn13' | 'isbn10'): string | undefined {
  // Newer Amazon layout: rpi-attribute panels
  const rpi = $(`#rpi-attribute-book_details-${field} .rpi-attribute-value span`).first().text().trim();
  if (rpi) return rpi.replace(/[^0-9X]/gi, '') || undefined;

  // Older layout: detail bullets
  const label = field === 'isbn13' ? /isbn-?13/i : /isbn-?10/i;
  const value = detailBulletValue($, label);
  return value ? value.replace(/[^0-9X]/gi, '') || undefined : undefined;
}

function extractPublisher($: CheerioAPI): string | undefined {
  // Newer layout
  const rpi = $('#rpi-attribute-book_details-publisher .rpi-attribute-value span').first().text().trim();
  if (rpi) return rpi || undefined;

  // Older layout: "Publisher : Penguin (Jan 1, 2020)"
  const raw = detailBulletValue($, /publisher/i);
  if (!raw) return undefined;
  // Strip date in parentheses at the end
  return raw.replace(/\s*\([^)]*\)\s*$/, '').trim() || undefined;
}

function extractPublishedYear($: CheerioAPI): number | undefined {
  // Newer layout
  const rpiText = $('#rpi-attribute-book_details-publication_date .rpi-attribute-value span').first().text().trim();
  if (rpiText) {
    const y = parseYearFromText(rpiText);
    if (y) return y;
  }

  // Older layout: extract year from parenthesised date in publisher bullet
  const publisherBullet = detailBulletValue($, /publisher/i);
  const match = publisherBullet.match(/\(([^)]+)\)/);
  if (match) {
    const y = parseYearFromText(match[1]);
    if (y) return y;
  }
  return undefined;
}

function extractLanguage($: CheerioAPI): string | undefined {
  const rpi = $('#rpi-attribute-language .rpi-attribute-value span').first().text().trim();
  if (rpi) return rpi || undefined;
  return detailBulletValue($, /language/i) || undefined;
}

function extractPageCount($: CheerioAPI): number | undefined {
  const rpi = $('#rpi-attribute-book_details-fiona_pages .rpi-attribute-value span').first().text().trim();
  const text = rpi || detailBulletValue($, /print length|pages/i);
  const digits = text.match(/\d+/)?.[0];
  return digits ? parseInt(digits, 10) : undefined;
}

function extractSeriesName($: CheerioAPI): string | undefined {
  return $('#rpi-attribute-book_details-series .rpi-attribute-value a span').first().text().trim() || undefined;
}

function extractSeriesIndex($: CheerioAPI): number | undefined {
  const label = $('#rpi-attribute-book_details-series .rpi-attribute-label span').first().text();
  const match = label.match(/book\s+(\d+(?:\.\d+)?)\s+of/i);
  if (!match) return undefined;
  const n = parseFloat(match[1]);
  return Number.isNaN(n) ? undefined : n;
}

function extractCoverUrl($: CheerioAPI): string | undefined {
  const img = $('#landingImage, #imgBlkFront').first();
  const hires = img.attr('data-old-hires');
  if (hires) return hires;
  const src = img.attr('src');
  // Strip Amazon's dimension modifier (e.g. ._SX260_) to get the original image
  return src ? src.replace(/\._[A-Z0-9_,]+_\./i, '.') : undefined;
}

function extractCategories($: CheerioAPI): string[] {
  const seen = new Set<string>();
  const cats: string[] = [];

  const add = (raw: string) => {
    const name = raw
      .trim()
      .replace(/\s*\(Books\)\s*$/i, '')
      .trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      cats.push(name);
    }
  };

  // Primary: bestseller rank categories
  $('#detailBullets_feature_div .zg_hrsr .a-list-item a').each((_, el) => add($(el).text()));

  // Fallback: breadcrumb navigation
  if (cats.length === 0) {
    $('#wayfinding-breadcrumbs_feature_div li:not(.a-breadcrumb-divider) a').each((_, el) => add($(el).text()));
  }

  return cats;
}

// --- Helpers ---

function detailBulletValue($: CheerioAPI, labelPattern: RegExp): string {
  let value = '';
  $('#detailBullets_feature_div .a-text-bold').each((_, el) => {
    if (labelPattern.test($(el).text())) {
      value = $(el).next().text().trim();
      return false; // break
    }
  });
  return value;
}

function parseYearFromText(text: string): number | undefined {
  const match = text.match(/\b(1[0-9]{3}|2[0-9]{3})\b/);
  return match ? parseInt(match[1], 10) : undefined;
}
