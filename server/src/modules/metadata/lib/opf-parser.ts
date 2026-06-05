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
  ranobedbId: string | null;
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

function parseBookOrbitTags(raw: string | null): string[] {
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

function normalizeCreatorRole(role: string | null | undefined): string {
  if (!role) return '';
  const trimmed = role.trim().toLowerCase();
  if (!trimmed) return '';
  const pathParts = trimmed.split('/');
  const withoutPath = pathParts[pathParts.length - 1] ?? trimmed;
  const colonParts = withoutPath.split(':');
  return colonParts[colonParts.length - 1] ?? withoutPath;
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
  subtitle ??= namedMeta('bookorbit:subtitle');

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
    const role = normalizeCreatorRole(role3 ?? role2 ?? 'aut');
    if (role !== 'aut' && role !== '') continue; // skip editors, illustrators, etc.

    // EPUB 3: file-as via refines; EPUB 2: opf:file-as attribute
    const sortName = (id ? getRefineValue(refineMap, id, 'file-as') : null) ?? ((mo['@_opf:file-as'] ?? mo['@_file-as'] ?? null) as string | null);

    authors.push({ name, sortName: sortName?.trim() || null });
  }

  // ── Identifiers → ISBN + provider IDs ─────────────────────────────────────
  let isbn10: string | null = null;
  let isbn13: string | null = null;

  // Two-pass collection: opf:scheme-based identifiers take priority over urn:-based ones
  // regardless of document order. Collect both sets first, then resolve.
  let schemeGoogleBooksId: string | null = null;
  let schemeGoodreadsId: string | null = null;
  let schemeAmazonId: string | null = null;
  let schemeHardcoverId: string | null = null;
  let schemeOpenLibraryId: string | null = null;
  let schemeRanobedbId: string | null = null;
  let schemeItunesId: string | null = null;

  let urnGoogleBooksId: string | null = null;
  let urnGoodreadsId: string | null = null;
  let urnAmazonId: string | null = null;
  let urnHardcoverId: string | null = null;
  let urnOpenLibraryId: string | null = null;
  let urnRanobedbId: string | null = null;
  let urnItunesId: string | null = null;

  for (const ident of toArray(metadata['identifier'])) {
    const mo = (typeof ident === 'object' && ident !== null ? ident : {}) as Record<string, unknown>;
    const scheme = ((mo['@_opf:scheme'] ?? mo['@_scheme'] ?? '') as string).toLowerCase().trim();
    const value = getText(ident);
    if (!value) continue;

    const looksLikeBareIsbn = scheme === '' && /^[\d\s-]{9,17}$/.test(value) && /^\d{9}[\dX]$|^\d{13}$/.test(value.replace(/[\s-]/g, ''));
    if (scheme === 'isbn' || value.toLowerCase().includes('isbn') || looksLikeBareIsbn) {
      const parsed = parseIsbn(value);
      isbn10 ??= parsed.isbn10;
      isbn13 ??= parsed.isbn13;
    }

    // opf:scheme-based provider identifiers (preferred format)
    if (scheme === 'google') schemeGoogleBooksId ??= value || null;
    if (scheme === 'amazon') schemeAmazonId ??= value || null;
    if (scheme === 'goodreads') schemeGoodreadsId ??= value || null;
    if (scheme === 'hardcover') schemeHardcoverId ??= value || null;
    if (scheme === 'openlibrary') schemeOpenLibraryId ??= value || null;
    if (scheme === 'ranobedb') schemeRanobedbId ??= value || null;
    if (scheme === 'itunes') schemeItunesId ??= value || null;

    // urn:-prefixed provider identifiers (legacy / backward-compat)
    if (value.startsWith('urn:goodreads:')) urnGoodreadsId ??= value.slice('urn:goodreads:'.length) || null;
    if (value.startsWith('urn:amazon:')) urnAmazonId ??= value.slice('urn:amazon:'.length) || null;
    if (value.startsWith('urn:hardcover:')) urnHardcoverId ??= value.slice('urn:hardcover:'.length) || null;
    if (value.startsWith('urn:google:')) urnGoogleBooksId ??= value.slice('urn:google:'.length) || null;
    if (value.startsWith('urn:openlibrary:')) urnOpenLibraryId ??= value.slice('urn:openlibrary:'.length) || null;
    if (value.startsWith('urn:ranobedb:')) urnRanobedbId ??= value.slice('urn:ranobedb:'.length) || null;
    if (value.startsWith('urn:itunes:')) urnItunesId ??= value.slice('urn:itunes:'.length) || null;
  }

  // opf:scheme wins over urn: when both are present
  const googleBooksId = schemeGoogleBooksId ?? urnGoogleBooksId;
  const goodreadsId = schemeGoodreadsId ?? urnGoodreadsId;
  const amazonId = schemeAmazonId ?? urnAmazonId;
  const hardcoverId = schemeHardcoverId ?? urnHardcoverId;
  const openLibraryId = schemeOpenLibraryId ?? urnOpenLibraryId;
  const ranobedbId = schemeRanobedbId ?? urnRanobedbId;
  const itunesId = schemeItunesId ?? urnItunesId;

  isbn10 ??= propertyMeta('bookorbit:isbn10') ?? namedMeta('bookorbit:isbn10');

  // ── Genres and tags ────────────────────────────────────────────────────────
  const genres = toArray(metadata['subject']).map(getText).filter(Boolean);
  const tags = parseBookOrbitTags(propertyMeta('bookorbit:tags') ?? namedMeta('bookorbit:tags'));
  const pageCount = parseNumber(propertyMeta('bookorbit:page_count') ?? namedMeta('bookorbit:page_count'));
  const rating = parseNumber(propertyMeta('bookorbit:rating') ?? namedMeta('bookorbit:rating'));

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
  const descriptionNode = toArray(metadata['description'])[0];
  const description = getText(descriptionNode) || null;
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
    ranobedbId,
    itunesId,
  };
}
