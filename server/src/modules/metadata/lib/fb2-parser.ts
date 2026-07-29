import { readFile } from 'fs/promises';
import { XMLParser } from 'fast-xml-parser';

import { BOOKORBIT_NS_PREFIX } from '../../../common/bookorbit-ns';
import { decodeFb2Document } from '../../../common/utils/fb2-encoding.utils';
import { parsePublishedDateKey } from '../../../common/utils/published-date.utils';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  textNodeName: '#text',
});

function text(val: unknown): string | null {
  if (typeof val === 'string') return val.trim() || null;
  if (typeof val === 'number') return String(val);
  if (typeof val === 'object' && val !== null && '#text' in val) {
    const textNode = (val as Record<string, unknown>)['#text'];
    if (typeof textNode === 'string') return textNode.trim() || null;
    if (typeof textNode === 'number') return String(textNode);
  }
  return null;
}

function toArray(val: unknown): unknown[] {
  if (Array.isArray(val)) return val;
  if (val != null) return [val];
  return [];
}

function stripHtml(val: string): string {
  return val
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractAnnotationText(val: unknown): string {
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return val.map(extractAnnotationText).filter(Boolean).join(' ');
  if (typeof val === 'object' && val !== null) {
    return Object.values(val as Record<string, unknown>)
      .map(extractAnnotationText)
      .filter(Boolean)
      .join(' ');
  }
  return '';
}

function parseFb2YearNode(val: unknown): number | null {
  const candidates: string[] = [];
  const direct = text(val);
  if (direct) candidates.push(direct);

  if (typeof val === 'object' && val !== null) {
    const objectNode = val as Record<string, unknown>;
    const valueAttr = text(objectNode['@_value']);
    if (valueAttr) candidates.push(valueAttr);
  }

  for (const candidate of candidates) {
    const match = candidate.match(/(\d{4})/);
    if (!match) continue;
    const year = parseInt(match[1], 10);
    if (!isNaN(year) && year > 1000 && year < 2200) return year;
  }

  return null;
}

function parseFb2DateNode(val: unknown): string | null {
  const candidates: string[] = [];
  const direct = text(val);
  if (direct) candidates.push(direct);

  if (typeof val === 'object' && val !== null) {
    const objectNode = val as Record<string, unknown>;
    const valueAttr = text(objectNode['@_value']);
    if (valueAttr) candidates.push(valueAttr);
  }

  for (const candidate of candidates) {
    const publishedDate = parsePublishedDateKey(candidate);
    if (publishedDate) return publishedDate;
  }

  return null;
}

/** Fields BookOrbit writes into <custom-info info-type="bookorbit:*">. */
const CUSTOM_INFO_FIELDS = [
  'subtitle',
  'pageCount',
  'rating',
  'isbn10',
  'googleBooksId',
  'goodreadsId',
  'amazonId',
  'hardcoverId',
  'hardcoverEditionId',
  'openLibraryId',
  'ranobedbId',
  'koboId',
  'lubimyczytacId',
  'aladinId',
  'itunesId',
] as const;

export type Fb2CustomInfoField = (typeof CUSTOM_INFO_FIELDS)[number];

export interface Fb2Metadata {
  title: string | null;
  description: string | null;
  language: string | null;
  publishedDate: string | null;
  publishedYear: number | null;
  seriesName: string | null;
  seriesIndex: number | null;
  authors: { name: string; sortName: string | null }[];
  genres: string[];
  tags: string[];
  publisher: string | null;
  isbn13: string | null;
  custom: Partial<Record<Fb2CustomInfoField, string>>;
}

function parseCustomInfo(description: Record<string, unknown> | undefined): Partial<Record<Fb2CustomInfoField, string>> {
  const custom: Partial<Record<Fb2CustomInfoField, string>> = {};
  if (!description) return custom;

  for (const entry of toArray(description['custom-info'])) {
    if (typeof entry !== 'object' || entry === null) continue;
    const infoType = text((entry as Record<string, unknown>)['@_info-type']);
    if (!infoType?.startsWith(`${BOOKORBIT_NS_PREFIX}:`)) continue;

    const field = infoType.slice(BOOKORBIT_NS_PREFIX.length + 1) as Fb2CustomInfoField;
    if (!CUSTOM_INFO_FIELDS.includes(field)) continue;

    const value = text(entry);
    if (value) custom[field] = value;
  }

  return custom;
}

export async function parseFb2File(absolutePath: string): Promise<Fb2Metadata | null> {
  try {
    // FB2 is commonly published in windows-1251 or koi8-r, so honour the
    // encoding declared in the file instead of assuming UTF-8.
    const { text: xml } = decodeFb2Document(await readFile(absolutePath));
    const doc = parser.parse(xml) as Record<string, unknown>;

    const fb = (doc['FictionBook'] ?? doc['fictionbook']) as Record<string, unknown> | undefined;
    if (!fb) return null;

    const description = fb['description'] as Record<string, unknown> | undefined;
    const titleInfo = description?.['title-info'] as Record<string, unknown> | undefined;
    if (!titleInfo) return null;

    const title = text(titleInfo['book-title']);

    // Authors: each <author> has <first-name>, <middle-name>, <last-name>, <nickname>
    const authors: { name: string; sortName: string | null }[] = [];
    for (const a of toArray(titleInfo['author'])) {
      const ao = a as Record<string, unknown>;
      const parts = [text(ao['first-name']), text(ao['middle-name']), text(ao['last-name'])].filter(Boolean);
      if (parts.length > 0) {
        const name = parts.join(' ');
        const last = text(ao['last-name']);
        const first = text(ao['first-name']);
        const sortName = last && first ? `${last}, ${first}` : null;
        authors.push({ name, sortName });
      } else {
        const nick = text(ao['nickname']);
        if (nick) authors.push({ name: nick, sortName: null });
      }
    }

    // Genres
    const genres = toArray(titleInfo['genre'])
      .map((g) => text(g))
      .filter((g): g is string => g !== null);

    // Language
    const language = text(titleInfo['lang']);

    // Series: <sequence name="..." number="..."/>
    let seriesName: string | null = null;
    let seriesIndex: number | null = null;
    const seqRaw = titleInfo['sequence'];
    if (seqRaw != null) {
      const seq = (Array.isArray(seqRaw) ? seqRaw[0] : seqRaw) as Record<string, unknown>;
      seriesName = text(seq['@_name']);
      const num = seq['@_number'];
      if (typeof num === 'string' || typeof num === 'number') {
        const parsed = parseFloat(String(num));
        if (!isNaN(parsed)) seriesIndex = parsed;
      }
    }

    // <publish-info> usually carries only a year, so a full date in
    // <title-info> wins when it is available.
    const publishInfo = description?.['publish-info'] as Record<string, unknown> | undefined;
    const titleInfoDate = titleInfo['date'];
    const publishInfoYear = publishInfo?.['year'];
    const publishedDate = parseFb2DateNode(titleInfoDate) ?? parseFb2DateNode(publishInfoYear);
    const publishedYear = parseFb2YearNode(publishInfoYear) ?? parseFb2YearNode(titleInfoDate);

    // Annotation (description)
    let annotationDescription: string | null = null;
    const annotRaw = titleInfo['annotation'];
    if (annotRaw != null) {
      const annotStr = annotRaw != null ? extractAnnotationText(annotRaw) : null;
      if (annotStr) annotationDescription = stripHtml(annotStr) || null;
    }

    const keywords = text(titleInfo['keywords']);
    const tags = keywords
      ? keywords
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
      : [];

    return {
      title,
      description: annotationDescription,
      language,
      publishedDate,
      publishedYear,
      seriesName,
      seriesIndex,
      authors,
      genres,
      tags,
      publisher: text(publishInfo?.['publisher']),
      isbn13: text(publishInfo?.['isbn']),
      custom: parseCustomInfo(description),
    };
  } catch {
    return null;
  }
}
