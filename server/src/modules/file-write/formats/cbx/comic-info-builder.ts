import { XMLParser, XMLBuilder } from 'fast-xml-parser';

import type { BookWritePayload, BookWritePayloadKey } from '../../interfaces/book-write-payload.interface';
import { COMIC_INFO_MANAGED_NOTES_KEYS, COMIC_INFO_PROVIDER_ID_KEYS, COMIC_INFO_PROVIDER_WEB_URL_BUILDERS } from '../../file-write.constants';
import { htmlToPlainText } from '../../../../common/utils/html-to-text.utils';

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

  setComicInfoField(info, fieldMask, 'title', 'Title', payload.title);
  setComicInfoField(info, fieldMask, 'description', 'Summary', payload.description, htmlToPlainText);
  setComicInfoField(info, fieldMask, 'publisher', 'Publisher', payload.publisher);
  setComicInfoField(info, fieldMask, 'seriesName', 'Series', payload.seriesName);
  setIssueNumberField(info, fieldMask, payload);
  setComicInfoField(info, fieldMask, 'comicVolumeName', 'Volume', payload.comicVolumeName);
  setComicInfoPublicationDate(info, fieldMask, payload);
  setComicInfoField(info, fieldMask, 'pageCount', 'PageCount', payload.pageCount);
  setComicInfoField(info, fieldMask, 'language', 'LanguageISO', payload.language);
  setComicInfoField(info, fieldMask, 'authors', 'Writer', payload.authors?.length ? payload.authors.map((a) => a.name).join(', ') : null);
  setComicInfoField(info, fieldMask, 'genres', 'Genre', payload.genres?.length ? payload.genres.join(', ') : null);
  setComicInfoField(info, fieldMask, 'tags', 'Tags', payload.tags?.length ? payload.tags.join(', ') : null);
  setComicInfoField(info, fieldMask, 'rating', 'CommunityRating', payload.rating, formatRating);
  setComicInfoField(info, fieldMask, 'isbn13', 'GTIN', payload.isbn13);
  setComicInfoListField(info, fieldMask, 'comicPencillers', 'Penciller', payload.comicPencillers);
  setComicInfoListField(info, fieldMask, 'comicInkers', 'Inker', payload.comicInkers);
  setComicInfoListField(info, fieldMask, 'comicColorists', 'Colorist', payload.comicColorists);
  setComicInfoListField(info, fieldMask, 'comicLetterers', 'Letterer', payload.comicLetterers);
  setComicInfoListField(info, fieldMask, 'comicCoverArtists', 'CoverArtist', payload.comicCoverArtists);
  setComicInfoListField(info, fieldMask, 'comicCharacters', 'Characters', payload.comicCharacters);
  setComicInfoListField(info, fieldMask, 'comicTeams', 'Teams', payload.comicTeams);
  setComicInfoListField(info, fieldMask, 'comicLocations', 'Locations', payload.comicLocations);
  setComicInfoListField(info, fieldMask, 'comicStoryArcs', 'StoryArc', payload.comicStoryArcs);

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

function formatSeriesIndex(val: number): string {
  return val % 1 === 0 ? String(Math.trunc(val)) : String(val);
}

function formatRating(val: number): string {
  return Math.min(5.0, Math.max(0.0, val / 2.0)).toFixed(1);
}

function setComicInfoPublicationDate(info: ComicInfoObject, fieldMask: Set<BookWritePayloadKey>, payload: BookWritePayload): void {
  const shouldWrite = fieldMask.has('publishedDate') || fieldMask.has('publishedYear');
  if (!shouldWrite) return;
  if (payload.publishedDate) {
    info['Year'] = Number(payload.publishedDate.slice(0, 4));
    info['Month'] = Number(payload.publishedDate.slice(5, 7));
    info['Day'] = Number(payload.publishedDate.slice(8, 10));
    return;
  }
  if (payload.publishedYear != null) {
    info['Year'] = payload.publishedYear;
    delete info['Month'];
    delete info['Day'];
    return;
  }
  delete info['Year'];
  delete info['Month'];
  delete info['Day'];
}

function setIssueNumberField(info: ComicInfoObject, fieldMask: Set<BookWritePayloadKey>, payload: BookWritePayload): void {
  const comicIssueNumber = payload.comicIssueNumber?.trim();
  if (fieldMask.has('comicIssueNumber')) {
    if (comicIssueNumber) {
      setComicInfoField(info, fieldMask, 'comicIssueNumber', 'Number', comicIssueNumber);
      return;
    }
    if (!fieldMask.has('seriesIndex')) {
      setComicInfoField(info, fieldMask, 'comicIssueNumber', 'Number', comicIssueNumber ?? null);
      return;
    }
  }

  setComicInfoField(info, fieldMask, 'seriesIndex', 'Number', payload.seriesIndex, formatSeriesIndex);
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

      const match = trimmed.match(/^\[bookorbit:([^\]]+)\]\s*(.*)$/);
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
      if (val != null && val !== '') lines.push(`[bookorbit:${key}] ${val}`);
      continue;
    }

    const existingVal = existingManaged.get(String(key));
    if (existingVal != null && existingVal !== '') {
      lines.push(`[bookorbit:${key}] ${existingVal}`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

function resolveManagedTextField(payload: BookWritePayload, key: BookWritePayloadKey): string | null {
  const value = payload[key];
  return typeof value === 'string' ? value : null;
}

function setComicInfoListField(
  info: ComicInfoObject,
  fieldMask: Set<BookWritePayloadKey>,
  key: BookWritePayloadKey,
  comicInfoKey: string,
  values: string[] | null | undefined,
): void {
  setComicInfoField(
    info,
    fieldMask,
    key,
    comicInfoKey,
    values
      ?.map((value) => value.trim())
      .filter(Boolean)
      .join(', ') ?? null,
  );
}

function setComicInfoField<TValue>(
  info: ComicInfoObject,
  fieldMask: Set<BookWritePayloadKey>,
  key: BookWritePayloadKey,
  comicInfoKey: string,
  value: TValue | null | undefined,
  formatter?: (value: TValue) => string | number,
): void {
  if (!fieldMask.has(key)) return;
  if (value == null || (typeof value === 'string' && value === '')) {
    delete info[comicInfoKey];
    return;
  }

  info[comicInfoKey] = formatter ? formatter(value) : value;
}
