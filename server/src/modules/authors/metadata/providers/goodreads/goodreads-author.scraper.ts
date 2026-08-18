import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';

import { parsePublishedDateKey, parsePublishedYear } from '../../../../../common/utils/published-date.utils';
import { GoodreadsAuthorAutocompleteItem, GoodreadsAuthorRef, ParsedGoodreadsAuthor } from './goodreads.types';

type Selection = ReturnType<CheerioAPI>;

const AUTHOR_LINK_RE = /\/author\/show\/(\d+)(?:\.([A-Za-z0-9_.]+))?/g;
const PLACEHOLDER_IMAGE_RE = /\/assets\/nophoto\//i;
const EXPANDER_LABEL_RE = /^\.{3}\s*more$/i;

function squash(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

// Goodreads renders long free-text twice: a truncated preview and the complete
// value behind a "...more" expander. Neither the order nor the element ids are
// contractual, so take whichever copy carries the most content.
function richestSpan($: CheerioAPI, container: Selection): Selection | null {
  const spans = container.find('span');
  if (spans.length === 0) return null;

  let best: Selection | null = null;
  let bestLength = -1;
  spans.each((_, el) => {
    const span = $(el);
    const length = squash(span.text()).length;
    if (length > bestLength) {
      bestLength = length;
      best = span;
    }
  });
  return best;
}

function spanText($: CheerioAPI, container: Selection): string {
  const span = richestSpan($, container);
  return squash(span ? span.text() : container.text());
}

function dataItem($: CheerioAPI, label: string): Selection | null {
  const title = $('.dataTitle').filter((_, el) => squash($(el).text()).replace(/:$/, '').toLowerCase() === label.toLowerCase());
  if (title.length === 0) return null;
  const item = title.first().next('.dataItem');
  return item.length > 0 ? item : null;
}

function linkList($: CheerioAPI, container: Selection | null): string[] {
  if (!container) return [];

  // The container holds both the truncated preview and the full list, so its
  // own link set is the union of the two and yields a clipped entry alongside
  // its complete twin ("Phil" next to "Philip K. Dick"). Read a single span
  // instead, and pick by text length: both copies carry the same number of
  // links, and only the full one spells the last entry out.
  const source = richestSpan($, container) ?? container;

  const values = source
    .find('a')
    .map((_, el) => squash($(el).text()))
    .get()
    .filter((value) => value.length > 0 && !EXPANDER_LABEL_RE.test(value));

  return [...new Set(values)];
}

function absoluteImageUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (PLACEHOLDER_IMAGE_RE.test(trimmed)) return undefined;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return undefined;
}

function normalizeWebsite(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed.slice(0, 2048);
  return undefined;
}

export function parseGoodreadsAuthorPage(html: string): ParsedGoodreadsAuthor | null {
  if (!html) return null;
  const $ = cheerio.load(html);

  const name = squash($('h1.authorName span[itemprop="name"]').first().text());
  if (!name) return null;

  const about = dataItemAbout($);
  const born = dataItem($, 'Born');
  const died = dataItem($, 'Died');
  const website = dataItem($, 'Website');

  const bornText = born ? squash(born.text()) : '';
  const diedText = died ? squash(died.text()) : '';

  const genres = linkList($, dataItem($, 'Genre'));
  const influences = linkList($, dataItem($, 'Influences'));

  return {
    name,
    description: about || undefined,
    imageUrl: absoluteImageUrl($('.authorLeftContainer img[itemprop="image"]').first().attr('src')),
    birthDate: parsePublishedDateKey(bornText),
    birthYear: parsePublishedYear(bornText),
    deathDate: parsePublishedDateKey(diedText),
    deathYear: parsePublishedYear(diedText),
    website: normalizeWebsite(website ? squash(website.find('a').first().text() || website.text()) : undefined),
    genres: genres.length > 0 ? genres : undefined,
    influences: influences.length > 0 ? influences : undefined,
  };
}

function dataItemAbout($: CheerioAPI): string {
  const container = $('.aboutAuthorInfo').first();
  if (container.length === 0) return '';
  return spanText($, container);
}

export function parseGoodreadsAuthorSearch(html: string): GoodreadsAuthorRef[] {
  if (!html) return [];

  const refs = new Map<string, string>();
  for (const match of html.matchAll(AUTHOR_LINK_RE)) {
    const providerId = match[1];
    if (refs.has(providerId)) continue;
    const slug = match[2] ?? '';
    refs.set(providerId, squash(slug.replace(/_/g, ' ')));
  }

  return [...refs].filter(([, name]) => name.length > 0).map(([providerId, name]) => ({ providerId, name }));
}

export function authorRefsFromAutocomplete(items: GoodreadsAuthorAutocompleteItem[] | null | undefined): GoodreadsAuthorRef[] {
  if (!items?.length) return [];

  const refs = new Map<string, string>();
  for (const item of items) {
    const id = item?.author?.id;
    const name = squash(item?.author?.name ?? '');
    if (id === undefined || id === null || !name) continue;
    const providerId = String(id).trim();
    if (!providerId || refs.has(providerId)) continue;
    refs.set(providerId, name);
  }

  return [...refs].map(([providerId, name]) => ({ providerId, name }));
}
