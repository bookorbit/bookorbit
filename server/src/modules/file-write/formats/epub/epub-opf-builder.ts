import { EPUB_BOOK_FILE_WRITE_FIELDS } from '@bookorbit/types';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { BookWritePayload, BookWritePayloadKey } from '../../interfaces/book-write-payload.interface';
import { EPUB_PROVIDER_IDENTIFIER_SCHEMES } from '../../file-write.constants';
import { BOOKORBIT_NS_PREFIX as APP_WRITE_NAMESPACE, BOOKORBIT_NS_URI as APP_NS_URI } from '../shared/bookorbit-ns';
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

const EPUB_WRITABLE_FIELDS = new Set<BookWritePayloadKey>(EPUB_BOOK_FILE_WRITE_FIELDS);
const CUSTOM_METADATA_PREFIX = `${APP_WRITE_NAMESPACE}:custom:`;

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

function getPackageNode(parsed: OrderedNode[]): { pkgNode: OrderedNode; pkgTag: string; pkgAttrs: Record<string, unknown> } | null {
  for (let i = 0; i < parsed.length; i++) {
    const node = parsed[i] as Record<string, unknown>;
    const pkgTag = nodeTagName(node);
    if (localName(pkgTag) === 'package') {
      const attrs = (node[':@'] ?? {}) as Record<string, unknown>;
      return { pkgNode: node, pkgTag, pkgAttrs: attrs };
    }
  }
  return null;
}

function findMetadata(pkgContent: OrderedNode[]): { node: OrderedNode; tag: string; children: OrderedNode[] } | null {
  for (const node of pkgContent) {
    const tag = nodeTagName(node);
    if (localName(tag) === 'metadata') {
      return { node, tag, children: (node[tag] as OrderedNode[]) ?? [] };
    }
  }
  return null;
}

function nodeTagName(node: OrderedNode): string {
  return Object.keys(node).find((k) => k !== ':@') ?? '';
}

function localName(tag: string): string {
  return tag.split(':').at(-1) ?? '';
}

function opfElementName(tag: string): string {
  return tag.startsWith('opf:') ? tag.slice(4) : tag;
}

function childTag(parentTag: string, name: string): string {
  const separatorIndex = parentTag.indexOf(':');
  return separatorIndex === -1 ? name : `${parentTag.slice(0, separatorIndex)}:${name}`;
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
    const tag = opfElementName(nodeTagName(node));
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
    const tag = opfElementName(nodeTagName(node));
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
      // Strip bookorbit: named metas
      if (name.startsWith(`${APP_WRITE_NAMESPACE}:`)) continue;
      // Strip bookorbit: property metas
      if (prop.startsWith(`${APP_WRITE_NAMESPACE}:`)) continue;
    }

    cleaned.push(node);
  }

  return { cleaned, uidNode };
}

function buildFreshMetadata(payload: BookWritePayload, epubVersion: 3 | 2, uidNode: OrderedNode | null, metaTag: string): OrderedNode[] {
  const nodes: OrderedNode[] = [];

  // Always re-insert UID node first
  if (uidNode) nodes.push(uidNode);

  // dc:title
  if (payload.title != null) {
    if (epubVersion === 3) {
      nodes.push(makeTextNode('dc:title', payload.title, { '@_id': 't-main' }));
      nodes.push(makeTextNode(metaTag, 'main', { '@_refines': '#t-main', '@_property': 'title-type' }));
    } else {
      nodes.push(makeTextNode('dc:title', payload.title));
    }
  }

  // subtitle (EPUB3 as second dc:title, EPUB2 as bookorbit:subtitle meta)
  if (payload.subtitle != null) {
    if (epubVersion === 3) {
      nodes.push(makeTextNode('dc:title', payload.subtitle, { '@_id': 't-sub' }));
      nodes.push(makeTextNode(metaTag, 'subtitle', { '@_refines': '#t-sub', '@_property': 'title-type' }));
    } else {
      nodes.push(makeEmptyNode(metaTag, { '@_name': `${APP_WRITE_NAMESPACE}:subtitle`, '@_content': payload.subtitle }));
    }
  }

  // dc:creator for each author
  if (payload.authors?.length) {
    for (const author of payload.authors) {
      const id = creatorId(author.name);
      const fileAs = author.sortName ?? author.name;
      if (epubVersion === 3) {
        nodes.push(makeTextNode('dc:creator', author.name, { '@_id': id }));
        nodes.push(makeTextNode(metaTag, 'aut', { '@_refines': `#${id}`, '@_property': 'role', '@_scheme': 'marc:relators' }));
        nodes.push(makeTextNode(metaTag, fileAs, { '@_refines': `#${id}`, '@_property': 'file-as' }));
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

  const publicationDate = resolvePublicationDate(payload);
  if (publicationDate != null) {
    nodes.push(makeTextNode('dc:date', publicationDate));
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
      nodes.push(makeTextNode(metaTag, payload.isbn10, { '@_property': `${APP_WRITE_NAMESPACE}:isbn10` }));
    } else {
      nodes.push(makeEmptyNode(metaTag, { '@_name': `${APP_WRITE_NAMESPACE}:isbn10`, '@_content': payload.isbn10 }));
    }
  }

  // Provider identifiers — opf:scheme attribute style (interoperable with Calibre and most readers)
  for (const field of EPUB_PROVIDER_IDENTIFIER_KEYS) {
    const value = payload[field];
    if (typeof value === 'string' && value !== '') {
      nodes.push(makeTextNode('dc:identifier', value, { '@_opf:scheme': EPUB_PROVIDER_IDENTIFIER_SCHEMES[field] }));
    }
  }

  // Series - dual write (Calibre EPUB2 + EPUB3 belongs-to-collection)
  if (payload.seriesName != null) {
    nodes.push(makeEmptyNode(metaTag, { '@_name': 'calibre:series', '@_content': payload.seriesName }));
    if (payload.seriesIndex != null) {
      nodes.push(makeEmptyNode(metaTag, { '@_name': 'calibre:series_index', '@_content': String(payload.seriesIndex) }));
    }

    const collectionId = 'series-col';
    nodes.push(makeTextNode(metaTag, payload.seriesName, { '@_id': collectionId, '@_property': 'belongs-to-collection' }));
    nodes.push(makeTextNode(metaTag, 'series', { '@_refines': `#${collectionId}`, '@_property': 'collection-type' }));
    if (payload.seriesIndex != null) {
      nodes.push(makeTextNode(metaTag, String(payload.seriesIndex), { '@_refines': `#${collectionId}`, '@_property': 'group-position' }));
    }
  }

  // pageCount
  if (payload.pageCount != null) {
    if (epubVersion === 3) {
      nodes.push(makeTextNode(metaTag, String(payload.pageCount), { '@_property': `${APP_WRITE_NAMESPACE}:page_count` }));
    } else {
      nodes.push(makeEmptyNode(metaTag, { '@_name': `${APP_WRITE_NAMESPACE}:page_count`, '@_content': String(payload.pageCount) }));
    }
  }

  // rating
  if (payload.rating != null) {
    if (epubVersion === 3) {
      nodes.push(makeTextNode(metaTag, String(payload.rating), { '@_property': `${APP_WRITE_NAMESPACE}:rating` }));
    } else {
      nodes.push(makeEmptyNode(metaTag, { '@_name': `${APP_WRITE_NAMESPACE}:rating`, '@_content': String(payload.rating) }));
    }
  }

  // tags as JSON
  if (payload.tags?.length) {
    const tagsJson = JSON.stringify(payload.tags);
    if (epubVersion === 3) {
      nodes.push(makeTextNode(metaTag, tagsJson, { '@_property': `${APP_WRITE_NAMESPACE}:tags` }));
    } else {
      nodes.push(makeEmptyNode(metaTag, { '@_name': `${APP_WRITE_NAMESPACE}:tags`, '@_content': tagsJson }));
    }
  }

  // Custom metadata
  for (const entry of payload.customMetadata ?? []) {
    if (entry.value === null || entry.value === undefined) continue;
    const property = `${CUSTOM_METADATA_PREFIX}${entry.key}`;
    const value = String(entry.value);
    if (epubVersion === 3) {
      nodes.push(makeTextNode(metaTag, value, { '@_property': property }));
    } else {
      nodes.push(makeEmptyNode(metaTag, { '@_name': property, '@_content': value }));
    }
  }

  // EPUB3: dcterms:modified is required
  if (epubVersion === 3) {
    nodes.push(makeTextNode(metaTag, new Date().toISOString(), { '@_property': 'dcterms:modified' }));
  }

  return nodes;
}

function getPkgContentAll(pkgNode: OrderedNode, pkgTag: string): OrderedNode[] {
  return pkgNode[pkgTag] as OrderedNode[];
}

export function build(opfXml: string, payload: BookWritePayload): { newOpfXml: string; fieldsWritten: string[] } {
  const parsed = writerParser.parse(opfXml) as OrderedNode[];
  const pkgResult = getPackageNode(parsed);
  if (!pkgResult) throw new Error('Cannot find <package> element in OPF');

  const { pkgNode, pkgTag, pkgAttrs } = pkgResult;
  const epubVersion = detectEpubVersion(pkgAttrs);
  const uidRef = getUniqueIdentifierRef(pkgAttrs);

  // Ensure bookorbit namespace prefix is declared on the <package> element for EPUB3.
  // pkgAttrs is a live reference to the :@ object inside the parsed tree, so
  // mutating it directly is sufficient - no need to walk children.
  if (epubVersion === 3) {
    const existingPrefix = attr(pkgAttrs, '@_prefix');
    const nsDecl = `${APP_WRITE_NAMESPACE}: ${APP_NS_URI}`;
    if (!existingPrefix.includes(`${APP_WRITE_NAMESPACE}:`)) {
      pkgAttrs['@_prefix'] = existingPrefix ? `${existingPrefix} ${nsDecl}` : nsDecl;
    }
  }

  // Ensure xmlns:opf is declared so opf:scheme attributes on dc:identifier (and opf:role/opf:file-as
  // on dc:creator in EPUB2) resolve to a bound namespace. Many EPUB3 files omit this declaration;
  // adding it to <package> is valid and covers the whole subtree.
  if (!attr(pkgAttrs, '@_xmlns:opf')) {
    pkgAttrs['@_xmlns:opf'] = 'http://www.idpf.org/2007/opf';
  }

  const pkgContent = getPkgContentAll(pkgNode, pkgTag);
  const metadata = findMetadata(pkgContent);
  if (!metadata) throw new Error('Cannot find <metadata> element in OPF');
  const { cleaned, uidNode } = stripMetadata(metadata.children, uidRef);
  const freshNodes = buildFreshMetadata(payload, epubVersion, uidNode, childTag(metadata.tag, 'meta'));
  const newMetaChildren = [...freshNodes, ...cleaned];
  metadata.node[metadata.tag] = newMetaChildren;

  const newOpfXml = String(writerBuilder.build(parsed));

  const customFieldsWritten = (payload.customMetadata ?? [])
    .filter((entry) => entry.value !== null && entry.value !== undefined)
    .map((entry) => `customMetadata:${entry.key}`);

  return { newOpfXml, fieldsWritten: [...resolveFieldsWritten(payload, EPUB_WRITABLE_FIELDS), ...customFieldsWritten] };
}

type EpubProviderIdentifierKey = keyof typeof EPUB_PROVIDER_IDENTIFIER_SCHEMES;
const EPUB_PROVIDER_IDENTIFIER_KEYS = Object.keys(EPUB_PROVIDER_IDENTIFIER_SCHEMES) as EpubProviderIdentifierKey[];

function resolvePublicationDate(payload: BookWritePayload): string | null {
  if (payload.publishedDate != null && payload.publishedDate !== '') return payload.publishedDate;
  if (payload.publishedYear != null) return `${payload.publishedYear}-01-01`;
  return null;
}
