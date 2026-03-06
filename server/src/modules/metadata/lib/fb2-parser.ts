import { readFile } from 'fs/promises';
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  textNodeName: '#text',
});

function text(val: unknown): string | null {
  if (typeof val === 'string') return val.trim() || null;
  if (typeof val === 'number') return String(val);
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

export interface Fb2Metadata {
  title: string | null;
  description: string | null;
  language: string | null;
  publishedYear: number | null;
  seriesName: string | null;
  seriesIndex: number | null;
  authors: { name: string; sortName: string | null }[];
  genres: string[];
}

export async function parseFb2File(absolutePath: string): Promise<Fb2Metadata | null> {
  try {
    const xml = await readFile(absolutePath, 'utf-8');
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

    // Year from <publish-info> or <title-info>
    let publishedYear: number | null = null;
    const publishInfo = description?.['publish-info'] as Record<string, unknown> | undefined;
    const yearRaw = publishInfo?.['year'] ?? titleInfo['date'];
    if (typeof yearRaw === 'string' || typeof yearRaw === 'number') {
      const y = parseInt(String(yearRaw), 10);
      if (!isNaN(y) && y > 1000 && y < 2200) publishedYear = y;
    }

    // Annotation (description)
    let description2: string | null = null;
    const annotRaw = titleInfo['annotation'];
    if (annotRaw != null) {
      const annotStr = annotRaw != null ? extractAnnotationText(annotRaw) : null;
      if (annotStr) description2 = stripHtml(annotStr) || null;
    }

    return { title, description: description2, language, publishedYear, seriesName, seriesIndex, authors, genres };
  } catch {
    return null;
  }
}
