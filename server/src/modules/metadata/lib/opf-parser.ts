import { XMLParser } from 'fast-xml-parser';

export interface ParsedOpf {
  title: string | null;
  subtitle: string | null;
  description: string | null;
  isbn10: string | null;
  isbn13: string | null;
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  pageCount: number | null;
  rating: number | null;
  seriesName: string | null;
  seriesIndex: number | null;
  authors: { name: string; sortName: string | null }[];
  genres: string[];
  tags: string[];
  googleBooksId: string | null;
  goodreadsId: string | null;
  amazonId: string | null;
  hardcoverId: string | null;
  openLibraryId: string | null;
  itunesId: string | null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  isArray: (name) => ['creator', 'identifier', 'subject', 'title', 'meta', 'item'].includes(name),
  textNodeName: '#text',
  allowBooleanAttributes: true,
  parseTagValue: false, // keep all values as strings — prevents leading-zero loss on ISBNs and numeric year conversion
});

function toArray<T>(val: T | T[] | undefined): T[] {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

function getText(node: unknown): string {
  if (typeof node === 'string') return node.trim();
  if (typeof node === 'object' && node !== null && '#text' in node) {
    return String((node as Record<string, unknown>)['#text']).trim();
  }
  return '';
}

function parseIsbn(raw: string): {
  isbn10: string | null;
  isbn13: string | null;
} {
  const digits = raw.replace(/[^\dX]/gi, '');
  if (digits.length === 13) return { isbn10: null, isbn13: digits };
  if (digits.length === 10) return { isbn10: digits, isbn13: null };
  return { isbn10: null, isbn13: null };
}

function parseYear(raw: string): number | null {
  const match = raw.match(/\d{4}/);
  return match ? parseInt(match[0], 10) : null;
}

function parseNumber(raw: string | null): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseProjectxTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item).trim()).filter(Boolean);
  } catch {
    return raw
      .split(/[,;]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

// Build a map of id → array of refining meta nodes (EPUB 3).
function buildRefineMap(metas: unknown[]): Map<string, unknown[]> {
  const map = new Map<string, unknown[]>();
  for (const meta of metas) {
    if (typeof meta !== 'object' || meta === null) continue;
    const m = meta as Record<string, unknown>;
    const refines = m['@_refines'];
    if (typeof refines === 'string') {
      const id = refines.startsWith('#') ? refines.slice(1) : refines;
      if (!map.has(id)) map.set(id, []);
      map.get(id)!.push(meta);
    }
  }
  return map;
}

function getRefineValue(refines: Map<string, unknown[]>, id: string, property: string): string | null {
  const nodes = refines.get(id) ?? [];
  for (const node of nodes) {
    const m = node as Record<string, unknown>;
    if (m['@_property'] === property) return getText(m);
  }
  return null;
}

export function parseOpf(xml: string): ParsedOpf {
  const root = parser.parse(xml) as Record<string, unknown>;
  const pkg = (root['package'] ?? root['opf:package'] ?? {}) as Record<string, unknown>;
  const metadata = (pkg['metadata'] ?? pkg['opf:metadata'] ?? {}) as Record<string, unknown>;

  const rawMetas = toArray(metadata['meta']);
  const refineMap = buildRefineMap(rawMetas);

  // ── Calibre/EPUB2 named metas ──────────────────────────────────────────────
  function namedMeta(name: string): string | null {
    for (const m of rawMetas) {
      if (typeof m !== 'object' || m === null) continue;
      const mo = m as Record<string, unknown>;
      if (mo['@_name'] === name) {
        const content = mo['@_content'];
        return (typeof content === 'string' ? content : '').trim() || null;
      }
    }
    return null;
  }

  function propertyMeta(property: string): string | null {
    for (const m of rawMetas) {
      if (typeof m !== 'object' || m === null) continue;
      const mo = m as Record<string, unknown>;
      if (mo['@_property'] === property) {
        return getText(m) || null;
      }
    }
    return null;
  }

  // ── Titles ─────────────────────────────────────────────────────────────────
  let title: string | null = null;
  let subtitle: string | null = null;

  const rawTitles = toArray(metadata['title']);
  if (rawTitles.length === 1) {
    title = getText(rawTitles[0]);
  } else if (rawTitles.length > 1) {
    // EPUB 3: look for title-type refinements.
    for (const t of rawTitles) {
      const mo = (typeof t === 'object' && t !== null ? t : {}) as Record<string, unknown>;
      const id = mo['@_id'] as string | undefined;
      const type = id ? getRefineValue(refineMap, id, 'title-type') : null;
      if (type === 'subtitle') subtitle = getText(t);
      else title ??= getText(t);
    }
    title ??= getText(rawTitles[0]);
  }
  subtitle ??= namedMeta('projectx:subtitle');

  // ── Authors ────────────────────────────────────────────────────────────────
  const authors: { name: string; sortName: string | null }[] = [];
  const rawCreators = toArray(metadata['creator']);

  for (const c of rawCreators) {
    const mo = (typeof c === 'object' && c !== null ? c : {}) as Record<string, unknown>;
    const name = getText(c);
    if (!name) continue;

    const id = mo['@_id'] as string | undefined;
    // EPUB 3: role via refines
    const role3 = id ? getRefineValue(refineMap, id, 'role') : null;
    // EPUB 2: opf:role attribute
    const role2 = (mo['@_opf:role'] ?? mo['@_role']) as string | undefined;
    const role = role3 ?? role2 ?? 'aut';
    if (role !== 'aut' && role !== '') continue; // skip editors, illustrators, etc.

    // EPUB 3: file-as via refines; EPUB 2: opf:file-as attribute
    const sortName = (id ? getRefineValue(refineMap, id, 'file-as') : null) ?? ((mo['@_opf:file-as'] ?? mo['@_file-as'] ?? null) as string | null);

    authors.push({ name, sortName: sortName?.trim() || null });
  }

  // ── Identifiers → ISBN ─────────────────────────────────────────────────────
  let isbn10: string | null = null;
  let isbn13: string | null = null;
  let googleBooksId: string | null = null;
  let goodreadsId: string | null = null;
  let amazonId: string | null = null;
  let hardcoverId: string | null = null;
  let openLibraryId: string | null = null;
  let itunesId: string | null = null;

  for (const ident of toArray(metadata['identifier'])) {
    const mo = (typeof ident === 'object' && ident !== null ? ident : {}) as Record<string, unknown>;
    const scheme = ((mo['@_opf:scheme'] ?? mo['@_scheme'] ?? '') as string).toLowerCase();
    const value = getText(ident);
    if (!value) continue;

    if (scheme === 'isbn' || value.toLowerCase().includes('isbn')) {
      const parsed = parseIsbn(value);
      isbn10 ??= parsed.isbn10;
      isbn13 ??= parsed.isbn13;
    }

    if (value.startsWith('urn:goodreads:')) goodreadsId ??= value.slice('urn:goodreads:'.length) || null;
    if (value.startsWith('urn:amazon:')) amazonId ??= value.slice('urn:amazon:'.length) || null;
    if (value.startsWith('urn:hardcover:')) hardcoverId ??= value.slice('urn:hardcover:'.length) || null;
    if (value.startsWith('urn:google:')) googleBooksId ??= value.slice('urn:google:'.length) || null;
    if (value.startsWith('urn:openlibrary:')) openLibraryId ??= value.slice('urn:openlibrary:'.length) || null;
    if (value.startsWith('urn:itunes:')) itunesId ??= value.slice('urn:itunes:'.length) || null;
  }

  isbn10 ??= propertyMeta('projectx:isbn10') ?? namedMeta('projectx:isbn10');

  // ── Genres and tags ────────────────────────────────────────────────────────
  const genres = toArray(metadata['subject']).map(getText).filter(Boolean);
  const projectxTags = parseProjectxTags(propertyMeta('projectx:tags') ?? namedMeta('projectx:tags'));
  const tags = projectxTags.length > 0 ? projectxTags : genres;
  const pageCount = parseNumber(propertyMeta('projectx:page_count') ?? namedMeta('projectx:page_count'));
  const rating = parseNumber(propertyMeta('projectx:rating') ?? namedMeta('projectx:rating'));

  // ── Series (Calibre EPUB2, then EPUB3) ────────────────────────────────────
  let seriesName: string | null = namedMeta('calibre:series');
  let seriesIndex: number | null = null;
  const rawSeriesIdx = namedMeta('calibre:series_index');
  if (rawSeriesIdx) {
    const idx = parseFloat(rawSeriesIdx);
    if (!isNaN(idx)) seriesIndex = idx;
  }

  if (!seriesName) {
    // EPUB 3: belongs-to-collection
    for (const m of rawMetas) {
      if (typeof m !== 'object' || m === null) continue;
      const mo = m as Record<string, unknown>;
      if (mo['@_property'] === 'belongs-to-collection') {
        seriesName = getText(m);
        const id = mo['@_id'] as string | undefined;
        if (id) {
          const pos = getRefineValue(refineMap, id, 'group-position');
          if (pos) seriesIndex = parseFloat(pos) || null;
        }
        break;
      }
    }
  }

  // ── Scalar fields ──────────────────────────────────────────────────────────
  const description = getText(metadata['description']) || null;
  const publisher = getText(metadata['publisher']) || null;
  const language = getText(metadata['language']) || null;

  const rawDate = toArray(metadata['date'])[0];
  const publishedYear = rawDate ? parseYear(getText(rawDate)) : null;

  return {
    title: title || null,
    subtitle: subtitle || null,
    description,
    isbn10,
    isbn13,
    publisher,
    publishedYear,
    language: language || null,
    pageCount,
    rating,
    seriesName: seriesName || null,
    seriesIndex,
    authors,
    genres,
    tags,
    googleBooksId,
    goodreadsId,
    amazonId,
    hardcoverId,
    openLibraryId,
    itunesId,
  };
}
