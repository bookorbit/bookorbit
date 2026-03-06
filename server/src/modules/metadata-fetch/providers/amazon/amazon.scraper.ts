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

const SKIP_TITLE_PATTERNS = /box\s*set|collection\s*set|books\s*set|omnibus|summary\s*&\s*study|streamer|display\s*kit|bookstore\s*kit|shelf\s*kit/i;

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

// Format preference: lower index = higher priority.
const FORMAT_PREFERENCE = ['kindle', 'paperback', 'mass market paperback', 'hardcover', 'library binding'];

export function extractAsins(html: string, limit: number): string[] {
  const $ = cheerio.load(html);
  const results: string[] = [];
  const seen = new Set<string>();

  $('div[data-component-type="s-search-result"]').each((_, el) => {
    if (results.length >= limit) return false;

    const titleText = $(el).find('[data-cy=title-recipe]').text().toLowerCase();
    if (SKIP_TITLE_PATTERNS.test(titleText)) return;

    // Collect all /dp/ASIN links with their visible label within this result block.
    const formatMap = new Map<string, string>(); // asin -> label (lowercased)
    $(el)
      .find('a[href*="/dp/"]')
      .each((_, a) => {
        const href = $(a).attr('href') ?? '';
        const m = /\/dp\/([A-Z0-9]{10})/i.exec(href);
        if (!m) return;
        const asin = m[1];
        if (formatMap.has(asin)) return;
        const label = $(a).text().trim().toLowerCase();
        if (label) formatMap.set(asin, label);
      });

    let chosen: string | undefined;

    if (formatMap.size > 0) {
      // Pick the highest-priority format available.
      let bestRank = Infinity;
      for (const [asin, label] of formatMap) {
        const rank = FORMAT_PREFERENCE.findIndex((f) => label.includes(f));
        const effectiveRank = rank === -1 ? FORMAT_PREFERENCE.length : rank;
        if (effectiveRank < bestRank) {
          bestRank = effectiveRank;
          chosen = asin;
        }
      }
    }

    // Fall back to the card's own data-asin when no format links were found.
    if (!chosen) {
      const cardAsin = $(el).attr('data-asin');
      if (cardAsin && cardAsin.length === 10) chosen = cardAsin;
    }

    if (chosen && !seen.has(chosen)) {
      seen.add(chosen);
      results.push(chosen);
    }
  });

  return results;
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
  const digits = text.replace(/,/g, '').match(/\d+/)?.[0];
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

  // data-a-dynamic-image is a JSON map of url -> [width, height] with all available sizes.
  // Cheerio decodes HTML entities in attr(), so &quot; becomes " automatically.
  const dynamicRaw = img.attr('data-a-dynamic-image');
  if (dynamicRaw) {
    try {
      const map = JSON.parse(dynamicRaw) as Record<string, [number, number]>;
      const entries = Object.entries(map);
      if (entries.length > 0) {
        // Strip the size modifier (e.g. ._SY342_) from any variant URL to get
        // the full-resolution original. All entries are the same image at different sizes.
        const [sampleUrl] = entries[0];
        return sampleUrl.replace(/\._[^.]+_\./, '.');
      }
    } catch {
      // fall through
    }
  }

  const hires = img.attr('data-old-hires');
  if (hires) return hires;
  const src = img.attr('src');
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
