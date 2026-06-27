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
  hardcoverEditionId: string | null;
  openLibraryId: string | null;
  ranobedbId: string | null;
  koboId: string | null;
  lubimyczytacId: string | null;
  aladinId: string | null;
  itunesId: string | null;
  customMetadata: Record<string, string>;
  coverHref: string | null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  isArray: (name) => ['creator', 'identifier', 'subject', 'title', 'meta', 'item', 'reference'].includes(name),
  textNodeName: '#text',
  allowBooleanAttributes: true,
  parseTagValue: false, // keep all values as strings to preserve ISBNs with leading zeroes
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

type ProviderKey =
  | 'google'
  | 'amazon'
  | 'goodreads'
  | 'hardcover'
  | 'hardcoverEdition'
  | 'openlibrary'
  | 'ranobedb'
  | 'kobo'
  | 'lubimyczytac'
  | 'aladin'
  | 'itunes';

// Calibre 9.x (opf3) writes provider identifiers as bare `prefix:value` text inside <dc:identifier>.
// Only these known prefixes are recognized, as a lowest-priority fallback after opf:scheme and urn:.
const PREFIX_TO_PROVIDER: Record<string, ProviderKey> = {
  amazon: 'amazon',
  asin: 'amazon',
  'mobi-asin': 'amazon',
  goodreads: 'goodreads',
  google: 'google',
  openlibrary: 'openlibrary',
  hardcover: 'hardcover',
  hardcover_edition: 'hardcoverEdition',
  'hardcover-edition': 'hardcoverEdition',
  hardcoveredition: 'hardcoverEdition',
  kobo: 'kobo',
  itunes: 'itunes',
  lubimyczytac: 'lubimyczytac',
  ranobedb: 'ranobedb',
  aladin: 'aladin',
};

const PROVIDER_PREFIXES: Record<ProviderKey, readonly string[]> = {
  amazon: ['urn:amazon:', 'amazon:', 'asin:', 'mobi-asin:'],
  google: ['urn:google:', 'google:'],
  goodreads: ['urn:goodreads:', 'goodreads:'],
  hardcover: ['urn:hardcover:', 'hardcover:'],
  hardcoverEdition: ['urn:hardcover_edition:', 'hardcover_edition:', 'hardcover-edition:', 'hardcoveredition:'],
  openlibrary: ['urn:openlibrary:', 'openlibrary:'],
  ranobedb: ['urn:ranobedb:', 'ranobedb:'],
  kobo: ['urn:kobo:', 'kobo:'],
  lubimyczytac: ['urn:lubimyczytac:', 'lubimyczytac:'],
  aladin: ['urn:aladin:', 'aladin:'],
  itunes: ['urn:itunes:', 'itunes:'],
};

function normalizeProviderId(provider: ProviderKey, raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  const lower = value.toLowerCase();
  for (const prefix of PROVIDER_PREFIXES[provider]) {
    if (lower.startsWith(prefix)) {
      return value.slice(prefix.length).trim() || null;
    }
  }

  return value;
}

// Calibre stores custom-column values in a `calibre:user_metadata` JSON blob keyed by column name,
// each value carrying the actual value under `#value#`. Used only to fill page count / subtitle when null.
function parseCalibreUserMetadata(raw: string | null): { pageCount: number | null; subtitle: string | null } {
  const empty = { pageCount: null, subtitle: null };
  if (!raw) return empty;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return empty;

  const cols = parsed as Record<string, unknown>;
  const columnValue = (key: string): unknown => {
    const col = cols[key];
    return typeof col === 'object' && col !== null && '#value#' in col ? (col as Record<string, unknown>)['#value#'] : undefined;
  };
  const coercePageCount = (v: unknown): number | null => {
    if (v === undefined || v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  };

  const pageCount = coercePageCount(columnValue('#pagecount')) ?? coercePageCount(columnValue('#page_count'));
  const subRaw = columnValue('#subtitle');
  const subtitle = typeof subRaw === 'string' && subRaw.trim() ? subRaw.trim() : null;
  return { pageCount, subtitle };
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

  const calibreUser = parseCalibreUserMetadata(propertyMeta('calibre:user_metadata'));

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
  subtitle ??= calibreUser.subtitle;

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
  let schemeHardcoverEditionId: string | null = null;
  let schemeOpenLibraryId: string | null = null;
  let schemeRanobedbId: string | null = null;
  let schemeKoboId: string | null = null;
  let schemeLubimyczytacId: string | null = null;
  let schemeAladinId: string | null = null;
  let schemeItunesId: string | null = null;

  let urnGoogleBooksId: string | null = null;
  let urnGoodreadsId: string | null = null;
  let urnAmazonId: string | null = null;
  let urnHardcoverId: string | null = null;
  let urnHardcoverEditionId: string | null = null;
  let urnOpenLibraryId: string | null = null;
  let urnRanobedbId: string | null = null;
  let urnKoboId: string | null = null;
  let urnLubimyczytacId: string | null = null;
  let urnAladinId: string | null = null;
  let urnItunesId: string | null = null;

  // Calibre prefix:value identifiers have the lowest priority, after scheme and urn.
  const prefixIds: Partial<Record<ProviderKey, string>> = {};

  for (const ident of toArray(metadata['identifier'])) {
    const mo = (typeof ident === 'object' && ident !== null ? ident : {}) as Record<string, unknown>;
    const scheme = ((mo['@_opf:scheme'] ?? mo['@_scheme'] ?? '') as string).toLowerCase().trim();
    const value = getText(ident);
    if (!value) continue;
    const lowerValue = value.toLowerCase();

    const looksLikeBareIsbn = scheme === '' && /^[\d\s-]{9,17}$/.test(value) && /^\d{9}[\dX]$|^\d{13}$/.test(value.replace(/[\s-]/g, ''));
    if (scheme === 'isbn' || lowerValue.includes('isbn') || looksLikeBareIsbn) {
      const parsed = parseIsbn(value);
      isbn10 ??= parsed.isbn10;
      isbn13 ??= parsed.isbn13;
    }

    // opf:scheme-based provider identifiers (preferred format)
    if (scheme === 'google') schemeGoogleBooksId ??= normalizeProviderId('google', value);
    if (scheme === 'amazon') schemeAmazonId ??= normalizeProviderId('amazon', value);
    if (scheme === 'goodreads') schemeGoodreadsId ??= normalizeProviderId('goodreads', value);
    if (scheme === 'hardcover') schemeHardcoverId ??= normalizeProviderId('hardcover', value);
    if (scheme === 'hardcover_edition' || scheme === 'hardcover-edition' || scheme === 'hardcoveredition') {
      schemeHardcoverEditionId ??= normalizeProviderId('hardcoverEdition', value);
    }
    if (scheme === 'openlibrary') schemeOpenLibraryId ??= normalizeProviderId('openlibrary', value);
    if (scheme === 'ranobedb') schemeRanobedbId ??= normalizeProviderId('ranobedb', value);
    if (scheme === 'kobo') schemeKoboId ??= normalizeProviderId('kobo', value);
    if (scheme === 'lubimyczytac') schemeLubimyczytacId ??= normalizeProviderId('lubimyczytac', value);
    if (scheme === 'aladin') schemeAladinId ??= normalizeProviderId('aladin', value);
    if (scheme === 'itunes') schemeItunesId ??= normalizeProviderId('itunes', value);

    // urn:-prefixed provider identifiers (legacy / backward-compat)
    if (lowerValue.startsWith('urn:goodreads:')) urnGoodreadsId ??= normalizeProviderId('goodreads', value);
    if (lowerValue.startsWith('urn:amazon:')) urnAmazonId ??= normalizeProviderId('amazon', value);
    if (lowerValue.startsWith('urn:hardcover:')) urnHardcoverId ??= normalizeProviderId('hardcover', value);
    if (lowerValue.startsWith('urn:hardcover_edition:')) urnHardcoverEditionId ??= normalizeProviderId('hardcoverEdition', value);
    if (lowerValue.startsWith('urn:hardcover-edition:')) urnHardcoverEditionId ??= normalizeProviderId('hardcoverEdition', value);
    if (lowerValue.startsWith('urn:google:')) urnGoogleBooksId ??= normalizeProviderId('google', value);
    if (lowerValue.startsWith('urn:openlibrary:')) urnOpenLibraryId ??= normalizeProviderId('openlibrary', value);
    if (lowerValue.startsWith('urn:ranobedb:')) urnRanobedbId ??= normalizeProviderId('ranobedb', value);
    if (lowerValue.startsWith('urn:kobo:')) urnKoboId ??= normalizeProviderId('kobo', value);
    if (lowerValue.startsWith('urn:lubimyczytac:')) urnLubimyczytacId ??= normalizeProviderId('lubimyczytac', value);
    if (lowerValue.startsWith('urn:aladin:')) urnAladinId ??= normalizeProviderId('aladin', value);
    if (lowerValue.startsWith('urn:itunes:')) urnItunesId ??= normalizeProviderId('itunes', value);

    // Calibre prefix:value only applies when there is no opf:scheme attribute and the value is not a urn.
    if (scheme === '' && !lowerValue.startsWith('urn:')) {
      const colon = value.indexOf(':');
      if (colon > 0) {
        const provider = PREFIX_TO_PROVIDER[value.slice(0, colon).toLowerCase()];
        if (provider) {
          const id = normalizeProviderId(provider, value);
          if (id) prefixIds[provider] ??= id;
        }
      }
    }
  }

  // Priority: opf:scheme, then urn:, then Calibre prefix:value.
  const googleBooksId = schemeGoogleBooksId ?? urnGoogleBooksId ?? prefixIds.google ?? null;
  const goodreadsId = schemeGoodreadsId ?? urnGoodreadsId ?? prefixIds.goodreads ?? null;
  const amazonId = schemeAmazonId ?? urnAmazonId ?? prefixIds.amazon ?? null;
  const hardcoverId = schemeHardcoverId ?? urnHardcoverId ?? prefixIds.hardcover ?? null;
  const hardcoverEditionId = schemeHardcoverEditionId ?? urnHardcoverEditionId ?? prefixIds.hardcoverEdition ?? null;
  const openLibraryId = schemeOpenLibraryId ?? urnOpenLibraryId ?? prefixIds.openlibrary ?? null;
  const ranobedbId = schemeRanobedbId ?? urnRanobedbId ?? prefixIds.ranobedb ?? null;
  const koboId = schemeKoboId ?? urnKoboId ?? prefixIds.kobo ?? null;
  const lubimyczytacId = schemeLubimyczytacId ?? urnLubimyczytacId ?? prefixIds.lubimyczytac ?? null;
  const aladinId = schemeAladinId ?? urnAladinId ?? prefixIds.aladin ?? null;
  const itunesId = schemeItunesId ?? urnItunesId ?? prefixIds.itunes ?? null;

  isbn10 ??= propertyMeta('bookorbit:isbn10') ?? namedMeta('bookorbit:isbn10');

  // ── Genres and tags ────────────────────────────────────────────────────────
  const genres = toArray(metadata['subject']).map(getText).filter(Boolean);
  const tags = parseBookOrbitTags(propertyMeta('bookorbit:tags') ?? namedMeta('bookorbit:tags'));
  let pageCount = parseNumber(propertyMeta('bookorbit:page_count') ?? namedMeta('bookorbit:page_count'));
  pageCount ??= calibreUser.pageCount;
  const rating = parseNumber(propertyMeta('bookorbit:rating') ?? namedMeta('bookorbit:rating'));
  const customMetadata = collectCustomMetadata(rawMetas);

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

  // ── Cover href (for sidecar OPFs linking to a sibling image file) ──────────
  // Priority 1: EPUB2 <guide><reference type="cover" href="..."/>
  // Priority 2: EPUB3 <manifest><item properties="cover-image" href="..."/>
  // Priority 3: Calibre <meta name="cover" content="manifest-item-id"/> -> manifest lookup
  let coverHref: string | null = null;

  const guide = (pkg['guide'] ?? {}) as Record<string, unknown>;
  for (const ref of toArray(guide['reference'])) {
    const ro = (typeof ref === 'object' && ref !== null ? ref : {}) as Record<string, unknown>;
    const type = ((ro['@_type'] as string | undefined) ?? '').toLowerCase().trim();
    if (type === 'cover') {
      const href = ((ro['@_href'] as string | undefined) ?? '').trim();
      if (href) {
        coverHref = href;
        break;
      }
    }
  }

  const manifest = (pkg['manifest'] ?? {}) as Record<string, unknown>;
  const manifestItems = toArray(manifest['item']);

  if (!coverHref) {
    for (const item of manifestItems) {
      const io = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
      const props = ((io['@_properties'] as string | undefined) ?? '').split(/\s+/);
      if (props.includes('cover-image')) {
        const href = ((io['@_href'] as string | undefined) ?? '').trim();
        if (href) {
          coverHref = href;
          break;
        }
      }
    }
  }

  if (!coverHref) {
    const coverItemId = namedMeta('cover');
    if (coverItemId) {
      for (const item of manifestItems) {
        const io = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
        if ((io['@_id'] as string | undefined) === coverItemId) {
          const href = ((io['@_href'] as string | undefined) ?? '').trim();
          if (href) {
            coverHref = href;
            break;
          }
        }
      }
    }
  }

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
    hardcoverEditionId,
    openLibraryId,
    ranobedbId,
    koboId,
    lubimyczytacId,
    aladinId,
    itunesId,
    customMetadata,
    coverHref,
  };
}

function collectCustomMetadata(rawMetas: unknown[]): Record<string, string> {
  const custom: Record<string, string> = {};
  const prefix = 'bookorbit:custom:';
  for (const meta of rawMetas) {
    if (typeof meta !== 'object' || meta === null) continue;
    const node = meta as Record<string, unknown>;
    const name = typeof node['@_name'] === 'string' ? node['@_name'] : '';
    const property = typeof node['@_property'] === 'string' ? node['@_property'] : '';
    const keySource = name.startsWith(prefix) ? name : property.startsWith(prefix) ? property : '';
    if (!keySource) continue;
    const key = keySource.slice(prefix.length);
    if (!/^[a-z0-9][a-z0-9_]{0,99}$/.test(key)) continue;
    const content = typeof node['@_content'] === 'string' ? node['@_content'].trim() : getText(meta);
    if (content) custom[key] = content;
  }
  return custom;
}
