import { XMLParser, XMLBuilder } from 'fast-xml-parser';

import type { BookWritePayload, BookWritePayloadKey } from '../../interfaces/book-write-payload.interface';
import { COMIC_INFO_MANAGED_NOTES_KEYS, COMIC_INFO_PROVIDER_ID_KEYS, COMIC_INFO_PROVIDER_WEB_URL_BUILDERS } from '../../file-write.constants';

type ComicInfoObject = Record<string, unknown>;

const PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: true,
  trimValues: true,
});

const BUILDER = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  indentBy: '  ',
  suppressBooleanAttributes: false,
});

function parseComicInfoXml(xml: string): ComicInfoObject {
  try {
    const parsed = PARSER.parse(xml) as { ComicInfo?: ComicInfoObject };
    return parsed.ComicInfo ?? {};
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    return {};
  }
}

export function buildComicInfoXml(existingXml: string | null, payload: BookWritePayload, fieldMask: Set<BookWritePayloadKey>): string {
  const info: ComicInfoObject = existingXml ? parseComicInfoXml(existingXml) : {};

  if (fieldMask.has('title') && payload.title != null) info['Title'] = payload.title;
  if (fieldMask.has('description') && payload.description != null) info['Summary'] = stripHtml(payload.description);
  if (fieldMask.has('publisher') && payload.publisher != null) info['Publisher'] = payload.publisher;
  if (fieldMask.has('seriesName') && payload.seriesName != null) info['Series'] = payload.seriesName;
  if (fieldMask.has('seriesIndex') && payload.seriesIndex != null) info['Number'] = formatSeriesIndex(payload.seriesIndex);
  if (fieldMask.has('publishedYear') && payload.publishedYear != null) info['Year'] = payload.publishedYear;
  if (fieldMask.has('pageCount') && payload.pageCount != null) info['PageCount'] = payload.pageCount;
  if (fieldMask.has('language') && payload.language != null) info['LanguageISO'] = payload.language;
  if (fieldMask.has('authors') && payload.authors?.length) info['Writer'] = payload.authors.map((a) => a.name).join(', ');
  if (fieldMask.has('genres') && payload.genres?.length) info['Genre'] = payload.genres.join(', ');
  if (fieldMask.has('tags') && payload.tags?.length) info['Tags'] = payload.tags.join(', ');
  if (fieldMask.has('rating') && payload.rating != null) info['CommunityRating'] = formatRating(payload.rating);
  if (fieldMask.has('isbn13') && payload.isbn13 != null) info['GTIN'] = payload.isbn13;

  const hasProviderSelection = COMIC_INFO_PROVIDER_ID_KEYS.some((key) => fieldMask.has(key));
  if (hasProviderSelection) {
    const webUrl = resolveWebUrl(payload, fieldMask);
    if (webUrl != null) {
      info['Web'] = webUrl;
    } else {
      delete info['Web'];
    }
  }

  const hasManagedNotesSelection = COMIC_INFO_MANAGED_NOTES_KEYS.some((key) => fieldMask.has(key));
  if (hasManagedNotesSelection) {
    const existingNotes = typeof info['Notes'] === 'string' ? info['Notes'] : null;
    const notes = buildNotes(existingNotes, payload, fieldMask);
    if (notes != null) {
      info['Notes'] = notes;
    } else {
      delete info['Notes'];
    }
  }

  if (!info['@_xmlns:xsi']) {
    info['@_xmlns:xsi'] = 'http://www.w3.org/2001/XMLSchema-instance';
    info['@_xmlns:xsd'] = 'http://www.w3.org/2001/XMLSchema';
  }

  const xmlBody = BUILDER.build({ ComicInfo: info });
  return `<?xml version="1.0" encoding="UTF-8"?>\n${xmlBody}`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function formatSeriesIndex(val: number): string {
  return val % 1 === 0 ? String(Math.trunc(val)) : String(val);
}

function formatRating(val: number): string {
  return Math.min(5.0, Math.max(0.0, val / 2.0)).toFixed(1);
}

function resolveWebUrl(payload: BookWritePayload, fieldMask: Set<BookWritePayloadKey>): string | null {
  for (const key of COMIC_INFO_PROVIDER_ID_KEYS) {
    if (!fieldMask.has(key)) continue;
    const value = payload[key];
    if (typeof value !== 'string' || value === '') continue;
    return COMIC_INFO_PROVIDER_WEB_URL_BUILDERS[key](value);
  }
  return null;
}

function buildNotes(existing: string | null, payload: BookWritePayload, fieldMask: Set<BookWritePayloadKey>): string | null {
  const lines: string[] = [];
  const existingManaged = new Map<string, string>();
  const managedKeys = new Set(COMIC_INFO_MANAGED_NOTES_KEYS.map((k) => String(k)));

  if (existing) {
    for (const line of existing.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const match = trimmed.match(/^\[projectx:([^\]]+)\]\s*(.*)$/);
      if (match) {
        const [, key, value] = match;
        if (managedKeys.has(key)) {
          existingManaged.set(key, value);
        } else {
          lines.push(trimmed);
        }
        continue;
      }
      lines.push(trimmed);
    }
  }

  const ids: [BookWritePayloadKey, string | null][] = COMIC_INFO_MANAGED_NOTES_KEYS.map((key) => [key, resolveManagedTextField(payload, key)]);

  for (const [key, val] of ids) {
    if (fieldMask.has(key)) {
      if (val != null && val !== '') lines.push(`[projectx:${key}] ${val}`);
      continue;
    }

    const existingVal = existingManaged.get(String(key));
    if (existingVal != null && existingVal !== '') {
      lines.push(`[projectx:${key}] ${existingVal}`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

function resolveManagedTextField(payload: BookWritePayload, key: BookWritePayloadKey): string | null {
  const value = payload[key];
  return typeof value === 'string' ? value : null;
}
