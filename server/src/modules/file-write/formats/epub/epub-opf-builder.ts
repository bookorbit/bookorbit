import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { BookWritePayload } from '../../interfaces/book-write-payload.interface';
import type { FormatWriteOptions } from '../../interfaces/format-write-options.interface';
import { PROJECTX_NS_PREFIX as APP_WRITE_NAMESPACE, PROJECTX_NS_URI as APP_NS_URI } from '../shared/projectx-ns';
import { resolveFieldsWritten } from '../shared/resolve-fields-written';

const writerParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: false,
  preserveOrder: true,
  isArray: (name) => ['dc:creator', 'dc:identifier', 'dc:subject', 'dc:title', 'meta', 'item', 'link', 'reference'].includes(name),
  textNodeName: '#text',
  allowBooleanAttributes: true,
});

const writerBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  textNodeName: '#text',
  suppressBooleanAttributes: false,
});

type OrderedNode = Record<string, unknown>;

function attr(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === 'string' ? v : '';
}

function creatorId(name: string): string {
  return (
    'creator-' +
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 30)
  );
}

function detectEpubVersion(pkg: Record<string, unknown>): 3 | 2 {
  const version = attr(pkg, '@_version');
  if (version.startsWith('3')) return 3;
  if (version.startsWith('2')) return 2;
  throw new Error(`Unsupported EPUB version: "${version || '(missing)'}"`);
}

function getUniqueIdentifierRef(pkg: Record<string, unknown>): string {
  return attr(pkg, '@_unique-identifier') || 'uid';
}

function getPackageNode(parsed: OrderedNode[]): { pkgNode: OrderedNode; pkgAttrs: Record<string, unknown>; pkgIndex: number } | null {
  for (let i = 0; i < parsed.length; i++) {
    const node = parsed[i] as Record<string, unknown>;
    if ('package' in node) {
      const attrs = (node[':@'] ?? {}) as Record<string, unknown>;
      return { pkgNode: node, pkgAttrs: attrs, pkgIndex: i };
    }
  }
  return null;
}

function findMetadataChildren(pkgContent: OrderedNode[]): OrderedNode[] {
  for (const node of pkgContent) {
    if ('metadata' in node || 'opf:metadata' in node) {
      const key = 'metadata' in node ? 'metadata' : 'opf:metadata';
      return (node[key] as OrderedNode[]) ?? [];
    }
  }
  return [];
}

function setMetadataChildren(pkgContent: OrderedNode[], children: OrderedNode[]): void {
  for (const node of pkgContent) {
    if ('metadata' in node) {
      (node as Record<string, unknown>)['metadata'] = children;
      return;
    }
    if ('opf:metadata' in node) {
      (node as Record<string, unknown>)['opf:metadata'] = children;
      return;
    }
  }
}

function nodeTagName(node: OrderedNode): string {
  return Object.keys(node).find((k) => k !== ':@') ?? '';
}

function getNodeAttrs(node: OrderedNode): Record<string, unknown> {
  return (node[':@'] as Record<string, unknown>) ?? {};
}

function makeTextNode(tag: string, text: string, attrs: Record<string, unknown> = {}): OrderedNode {
  const node: OrderedNode = { [tag]: [{ '#text': text }] };
  if (Object.keys(attrs).length > 0) node[':@'] = attrs;
  return node;
}

function makeEmptyNode(tag: string, attrs: Record<string, unknown> = {}): OrderedNode {
  const node: OrderedNode = { [tag]: [] };
  if (Object.keys(attrs).length > 0) node[':@'] = attrs;
  return node;
}

// Strips known metadata elements, returns cleaned array + UID node + version
function stripMetadata(children: OrderedNode[], uidRef: string): { cleaned: OrderedNode[]; uidNode: OrderedNode | null } {
  const KNOWN_DC = new Set(['dc:title', 'dc:creator', 'dc:description', 'dc:publisher', 'dc:date', 'dc:language', 'dc:subject', 'dc:identifier']);

  const CALIBRE_SERIES_NAMES = new Set(['calibre:series', 'calibre:series_index']);

  const BELONGS_TO_COLLECTION_PROPS = new Set(['belongs-to-collection', 'collection-type', 'group-position', 'dcterms:modified']);

  // Collect ids of dc:creator nodes so we can remove their refines
  const creatorIds = new Set<string>();
  // Collect id of belonging-to-collection so we can remove their refines
  const collectionIds = new Set<string>();

  for (const node of children) {
    const tag = nodeTagName(node);
    if (tag === 'dc:creator') {
      const id = attr(getNodeAttrs(node), '@_id');
      if (id) creatorIds.add(id);
    }
    if (tag === 'meta') {
      const nodeAttrs = getNodeAttrs(node);
      const prop = attr(nodeAttrs, '@_property');
      if (prop === 'belongs-to-collection') {
        const id = attr(nodeAttrs, '@_id');
        if (id) collectionIds.add(id);
      }
    }
  }

  let uidNode: OrderedNode | null = null;
  const cleaned: OrderedNode[] = [];

  for (const node of children) {
    const tag = nodeTagName(node);
    const nodeAttrs = getNodeAttrs(node);

    if (KNOWN_DC.has(tag)) {
      // Preserve the unique-identifier dc:identifier
      if (tag === 'dc:identifier') {
        const nodeId = attr(nodeAttrs, '@_id');
        if (nodeId === uidRef) {
          uidNode = node;
        }
      }
      // All other known DC elements are stripped
      continue;
    }

    if (tag === 'meta') {
      const name = attr(nodeAttrs, '@_name');
      const prop = attr(nodeAttrs, '@_property');
      const refines = attr(nodeAttrs, '@_refines');

      // Strip calibre:series metas
      if (CALIBRE_SERIES_NAMES.has(name)) continue;
      // Strip belongs-to-collection and its refines
      if (BELONGS_TO_COLLECTION_PROPS.has(prop)) continue;
      // Strip refines that point to creator ids or collection ids
      if (refines) {
        const refId = refines.startsWith('#') ? refines.slice(1) : refines;
        if (creatorIds.has(refId) || collectionIds.has(refId)) continue;
      }
      // Strip projectx: named metas
      if (name.startsWith(`${APP_WRITE_NAMESPACE}:`)) continue;
      // Strip projectx: property metas
      if (prop.startsWith(`${APP_WRITE_NAMESPACE}:`)) continue;
    }

    cleaned.push(node);
  }

  return { cleaned, uidNode };
}

function buildFreshMetadata(payload: BookWritePayload, epubVersion: 3 | 2, uidNode: OrderedNode | null): OrderedNode[] {
  const nodes: OrderedNode[] = [];

  // Always re-insert UID node first
  if (uidNode) nodes.push(uidNode);

  // dc:title
  if (payload.title != null) {
    if (epubVersion === 3) {
      nodes.push(makeTextNode('dc:title', payload.title, { '@_id': 't-main' }));
      nodes.push({ meta: [{ '#text': 'main' }], ':@': { '@_refines': '#t-main', '@_property': 'title-type' } } as OrderedNode);
    } else {
      nodes.push(makeTextNode('dc:title', payload.title));
    }
  }

  // subtitle (EPUB3 as second dc:title, EPUB2 as projectx:subtitle meta)
  if (payload.subtitle != null) {
    if (epubVersion === 3) {
      nodes.push(makeTextNode('dc:title', payload.subtitle, { '@_id': 't-sub' }));
      nodes.push({ meta: [{ '#text': 'subtitle' }], ':@': { '@_refines': '#t-sub', '@_property': 'title-type' } } as OrderedNode);
    } else {
      nodes.push(makeEmptyNode('meta', { '@_name': `${APP_WRITE_NAMESPACE}:subtitle`, '@_content': payload.subtitle }));
    }
  }

  // dc:creator for each author
  if (payload.authors?.length) {
    for (const author of payload.authors) {
      const id = creatorId(author.name);
      const fileAs = author.sortName ?? author.name;
      if (epubVersion === 3) {
        nodes.push(makeTextNode('dc:creator', author.name, { '@_id': id }));
        nodes.push({ meta: [{ '#text': 'aut' }], ':@': { '@_refines': `#${id}`, '@_property': 'role', '@_scheme': 'marc:relators' } } as OrderedNode);
        nodes.push({ meta: [{ '#text': fileAs }], ':@': { '@_refines': `#${id}`, '@_property': 'file-as' } } as OrderedNode);
      } else {
        nodes.push(
          makeTextNode('dc:creator', author.name, {
            '@_opf:role': 'aut',
            '@_opf:file-as': fileAs,
          }),
        );
      }
    }
  }

  // dc:description
  if (payload.description != null) {
    nodes.push(makeTextNode('dc:description', payload.description));
  }

  // dc:publisher
  if (payload.publisher != null) {
    nodes.push(makeTextNode('dc:publisher', payload.publisher));
  }

  // dc:date
  if (payload.publishedYear != null) {
    nodes.push(makeTextNode('dc:date', `${payload.publishedYear}-01-01`));
  }

  // dc:language
  if (payload.language != null) {
    nodes.push(makeTextNode('dc:language', payload.language));
  }

  // dc:subject per genre
  if (payload.genres?.length) {
    for (const g of payload.genres) {
      nodes.push(makeTextNode('dc:subject', g));
    }
  }

  // ISBN identifiers
  if (payload.isbn13 != null) {
    nodes.push(makeTextNode('dc:identifier', `urn:isbn:${payload.isbn13}`));
  }

  if (payload.isbn10 != null) {
    if (epubVersion === 3) {
      nodes.push({ meta: [{ '#text': payload.isbn10 }], ':@': { '@_property': `${APP_WRITE_NAMESPACE}:isbn10` } } as OrderedNode);
    } else {
      nodes.push(makeEmptyNode('meta', { '@_name': `${APP_WRITE_NAMESPACE}:isbn10`, '@_content': payload.isbn10 }));
    }
  }

  // Provider identifiers — plain dc:identifier with urn: text, no scheme/id attributes (matches Booklore)
  const providerMappings: Array<{ field: keyof BookWritePayload; urnPrefix: string }> = [
    { field: 'goodreadsId', urnPrefix: 'urn:goodreads:' },
    { field: 'amazonId', urnPrefix: 'urn:amazon:' },
    { field: 'hardcoverId', urnPrefix: 'urn:hardcover:' },
    { field: 'googleBooksId', urnPrefix: 'urn:google:' },
    { field: 'openLibraryId', urnPrefix: 'urn:openlibrary:' },
    { field: 'itunesId', urnPrefix: 'urn:itunes:' },
  ];

  for (const { field, urnPrefix } of providerMappings) {
    const value = payload[field] as string | null | undefined;
    if (value != null) {
      nodes.push(makeTextNode('dc:identifier', `${urnPrefix}${value}`));
    }
  }

  // Series - dual write (Calibre EPUB2 + EPUB3 belongs-to-collection)
  if (payload.seriesName != null) {
    nodes.push(makeEmptyNode('meta', { '@_name': 'calibre:series', '@_content': payload.seriesName }));
    if (payload.seriesIndex != null) {
      nodes.push(makeEmptyNode('meta', { '@_name': 'calibre:series_index', '@_content': String(payload.seriesIndex) }));
    }

    const collectionId = 'series-col';
    nodes.push(makeTextNode('meta', payload.seriesName, { '@_id': collectionId, '@_property': 'belongs-to-collection' }));
    nodes.push({ meta: [{ '#text': 'series' }], ':@': { '@_refines': `#${collectionId}`, '@_property': 'collection-type' } } as OrderedNode);
    if (payload.seriesIndex != null) {
      nodes.push({
        meta: [{ '#text': String(payload.seriesIndex) }],
        ':@': { '@_refines': `#${collectionId}`, '@_property': 'group-position' },
      } as OrderedNode);
    }
  }

  // pageCount
  if (payload.pageCount != null) {
    if (epubVersion === 3) {
      nodes.push({ meta: [{ '#text': String(payload.pageCount) }], ':@': { '@_property': `${APP_WRITE_NAMESPACE}:page_count` } } as OrderedNode);
    } else {
      nodes.push(makeEmptyNode('meta', { '@_name': `${APP_WRITE_NAMESPACE}:page_count`, '@_content': String(payload.pageCount) }));
    }
  }

  // rating
  if (payload.rating != null) {
    if (epubVersion === 3) {
      nodes.push({ meta: [{ '#text': String(payload.rating) }], ':@': { '@_property': `${APP_WRITE_NAMESPACE}:rating` } } as OrderedNode);
    } else {
      nodes.push(makeEmptyNode('meta', { '@_name': `${APP_WRITE_NAMESPACE}:rating`, '@_content': String(payload.rating) }));
    }
  }

  // tags as JSON
  if (payload.tags?.length) {
    const tagsJson = JSON.stringify(payload.tags);
    if (epubVersion === 3) {
      nodes.push({ meta: [{ '#text': tagsJson }], ':@': { '@_property': `${APP_WRITE_NAMESPACE}:tags` } } as OrderedNode);
    } else {
      nodes.push(makeEmptyNode('meta', { '@_name': `${APP_WRITE_NAMESPACE}:tags`, '@_content': tagsJson }));
    }
  }

  // EPUB3: dcterms:modified is required
  if (epubVersion === 3) {
    nodes.push({ meta: [{ '#text': new Date().toISOString() }], ':@': { '@_property': 'dcterms:modified' } } as OrderedNode);
  }

  return nodes;
}

function getPkgContentAll(pkgNode: OrderedNode): OrderedNode[] {
  return pkgNode['package'] as OrderedNode[];
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function build(opfXml: string, payload: BookWritePayload, _options: FormatWriteOptions): { newOpfXml: string; fieldsWritten: string[] } {
  const parsed = writerParser.parse(opfXml) as OrderedNode[];
  const pkgResult = getPackageNode(parsed);
  if (!pkgResult) throw new Error('Cannot find <package> element in OPF');

  const { pkgNode, pkgAttrs } = pkgResult;
  const epubVersion = detectEpubVersion(pkgAttrs);
  const uidRef = getUniqueIdentifierRef(pkgAttrs);

  // Ensure projectx namespace prefix is declared on the <package> element for EPUB3.
  // pkgAttrs is a live reference to the :@ object inside the parsed tree, so
  // mutating it directly is sufficient - no need to walk children.
  if (epubVersion === 3) {
    const existingPrefix = attr(pkgAttrs, '@_prefix');
    const nsDecl = `${APP_WRITE_NAMESPACE}: ${APP_NS_URI}`;
    if (!existingPrefix.includes(`${APP_WRITE_NAMESPACE}:`)) {
      pkgAttrs['@_prefix'] = existingPrefix ? `${existingPrefix} ${nsDecl}` : nsDecl;
    }
  }

  const pkgContent = getPkgContentAll(pkgNode);
  const metaChildren = findMetadataChildren(pkgContent);
  const { cleaned, uidNode } = stripMetadata(metaChildren, uidRef);
  const freshNodes = buildFreshMetadata(payload, epubVersion, uidNode);
  const newMetaChildren = [...freshNodes, ...cleaned];
  setMetadataChildren(pkgContent, newMetaChildren);

  const newOpfXml = String(writerBuilder.build(parsed));

  return { newOpfXml, fieldsWritten: resolveFieldsWritten(payload) };
}
