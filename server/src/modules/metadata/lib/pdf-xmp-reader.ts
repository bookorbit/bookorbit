import { XMLParser } from 'fast-xml-parser';
import { decodePDFRawStream, PDFDocument, PDFName, PDFRawStream, PDFRef } from 'pdf-lib';

import { BOOKORBIT_NS_PREFIX } from '../../../common/bookorbit-ns';

export interface XmpParsed {
  title: string | null;
  subtitle: string | null;
  description: string | null;
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  authors: { name: string; sortName: string | null }[];
  genres: string[];
  tags: string[];
  isbn10: string | null;
  isbn13: string | null;
  seriesName: string | null;
  seriesIndex: number | null;
  rating: number | null;
  pageCount: number | null;
  googleBooksId: string | null;
  goodreadsId: string | null;
  amazonId: string | null;
  hardcoverId: string | null;
  openLibraryId: string | null;
  ranobedbId: string | null;
  itunesId: string | null;
}

const xmpParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => name === 'rdf:li' || name === 'rdf:Description',
  textNodeName: '#text',
  allowBooleanAttributes: true,
  parseTagValue: false, // keep all values as strings — prevents leading-zero loss on ISBNs
});

export function extractXmpXml(doc: PDFDocument): string | null {
  const ref = doc.catalog.get(PDFName.of('Metadata'));
  if (!ref) return null;
  const stream = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
  if (!(stream instanceof PDFRawStream)) return null;
  try {
    const decoded = decodePDFRawStream(stream).decode();
    return Buffer.from(decoded).toString('utf-8');
  } catch {
    return Buffer.from(stream.contents).toString('utf-8');
  }
}

// Handles plain text, rdf:Alt (Calibre-style i18n), and rdf:Seq/Bag first-item fallback.
function getText(val: unknown): string | null {
  if (typeof val === 'string') return val.trim() || null;
  if (typeof val === 'number') return String(val);
  if (val && typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    // rdf:Alt — prefer x-default lang
    const alt = obj['rdf:Alt'] as Record<string, unknown> | undefined;
    if (alt) {
      const lis = (alt['rdf:li'] as unknown[]) ?? [];
      const def = lis.find((l) => typeof l === 'object' && (l as Record<string, unknown>)['@_xml:lang'] === 'x-default');
      const pick = def ?? lis[0];
      if (!pick) return null;
      return typeof pick === 'string' ? pick.trim() || null : getText((pick as Record<string, unknown>)['#text']);
    }
    // Seq/Bag — take first item as scalar
    const container = (obj['rdf:Seq'] ?? obj['rdf:Bag']) as Record<string, unknown> | undefined;
    if (container) {
      const lis = (container['rdf:li'] as unknown[]) ?? [];
      return lis.length ? getText(lis[0]) : null;
    }
    return getText(obj['#text']);
  }
  return null;
}

// Extracts an ordered or unordered list from rdf:Seq, rdf:Bag, or a plain string.
function getList(val: unknown): string[] {
  if (!val) return [];
  if (typeof val === 'string') return val.trim() ? [val.trim()] : [];
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    const container = (obj['rdf:Seq'] ?? obj['rdf:Bag'] ?? obj['rdf:Alt']) as Record<string, unknown> | undefined;
    if (container) {
      return ((container['rdf:li'] as unknown[]) ?? [])
        .map((l) => (typeof l === 'string' ? l.trim() : (getText(l as Record<string, unknown>) ?? '')))
        .filter(Boolean);
    }
  }
  return [];
}

function str(val: unknown): string | null {
  const t = getText(val);
  return t ?? null;
}

function num(val: unknown): number | null {
  const t = getText(val);
  if (!t) return null;
  const n = Number(t);
  return isFinite(n) ? n : null;
}

function parseYear(val: unknown): number | null {
  const t = getText(val);
  if (!t) return null;
  const m = t.match(/^(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}

export function parseXmp(xmpXml: string): XmpParsed | null {
  let root: Record<string, unknown>;
  try {
    root = xmpParser.parse(xmpXml) as Record<string, unknown>;
  } catch {
    return null;
  }

  const rdfRoot = (root['x:xmpmeta'] as Record<string, unknown> | undefined)?.['rdf:RDF'] ?? (root['rdf:RDF'] as Record<string, unknown> | undefined);
  if (!rdfRoot) return null;

  const descriptions = (rdfRoot['rdf:Description'] as Record<string, unknown>[]) ?? [];
  if (!descriptions.length) return null;

  // Merge all rdf:Description blocks into a flat map of all fields.
  const merged: Record<string, unknown> = {};
  for (const desc of descriptions) {
    for (const [k, v] of Object.entries(desc)) {
      if (!k.startsWith('@_') && !(k in merged)) merged[k] = v;
    }
  }

  const px = BOOKORBIT_NS_PREFIX;

  return {
    title: str(merged['dc:title']),
    subtitle: str(merged[`${px}:subtitle`]),
    description: str(merged['dc:description']),
    publisher: str(merged['dc:publisher']),
    publishedYear: parseYear(merged['dc:date']),
    language: str(merged['dc:language']),
    authors: getList(merged['dc:creator']).map((name) => ({ name, sortName: null })),
    genres: getList(merged['dc:subject']),
    tags: getList(merged[`${px}:tags`]),
    isbn10: str(merged[`${px}:isbn10`]),
    isbn13: str(merged[`${px}:isbn13`]),
    seriesName: str(merged[`${px}:seriesName`]),
    seriesIndex: num(merged[`${px}:seriesIndex`]),
    rating: num(merged[`${px}:rating`]),
    pageCount: num(merged[`${px}:pageCount`]),
    googleBooksId: str(merged[`${px}:googleBooksId`]),
    goodreadsId: str(merged[`${px}:goodreadsId`]),
    amazonId: str(merged[`${px}:amazonId`]),
    hardcoverId: str(merged[`${px}:hardcoverId`]),
    openLibraryId: str(merged[`${px}:openLibraryId`]),
    ranobedbId: str(merged[`${px}:ranobedbId`]),
    itunesId: str(merged[`${px}:itunesId`]),
  };
}
