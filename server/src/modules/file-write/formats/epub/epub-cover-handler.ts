import { posix } from 'path';

import { XMLBuilder, XMLParser } from 'fast-xml-parser';

import type { EpubCoverImage } from './epub-cover-image';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: false,
  preserveOrder: true,
  isArray: (name) => ['item', 'meta', 'reference'].includes(name),
  textNodeName: '#text',
  allowBooleanAttributes: true,
});

const documentParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: false,
  preserveOrder: true,
});

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  textNodeName: '#text',
});

type OrderedNode = Record<string, unknown>;
type ManifestItem = { attrs: Record<string, unknown>; entryPath: string | null };

const BOOKORBIT_COVER_ID = 'bookorbit-cover-image';
const BOOKORBIT_COVER_FILE = 'bookorbit-cover';

function attr(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  return typeof value === 'string' ? value : '';
}

function nodeTagName(node: OrderedNode): string {
  return Object.keys(node).find((key) => key !== ':@') ?? '';
}

function nodeLocalName(node: OrderedNode): string {
  return nodeTagName(node).split(':').at(-1) ?? '';
}

function childTag(parentTag: string, localName: string): string {
  const separatorIndex = parentTag.indexOf(':');
  return separatorIndex === -1 ? localName : `${parentTag.slice(0, separatorIndex)}:${localName}`;
}

function nodeAttrs(node: OrderedNode): Record<string, unknown> {
  return (node[':@'] as Record<string, unknown>) ?? {};
}

function entryDirectory(entryPath: string): string {
  const separatorIndex = entryPath.lastIndexOf('/');
  return separatorIndex === -1 ? '' : entryPath.slice(0, separatorIndex + 1);
}

function safeDecodeHref(rawHref: string): string | null {
  const withoutFragment = rawHref.split(/[?#]/, 1)[0]?.trim() ?? '';
  if (!withoutFragment) return null;

  try {
    return decodeURIComponent(withoutFragment);
  } catch {
    return null;
  }
}

function resolveEntryPath(base: string, rawHref: string): string | null {
  const href = safeDecodeHref(rawHref);
  if (!href || href.startsWith('/') || href.startsWith('\\') || href.includes('\\') || /^[a-z][a-z\d+.-]*:/i.test(href)) return null;

  const resolved: string[] = [];
  for (const part of `${base}${href}`.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (resolved.length === 0) return null;
      resolved.pop();
      continue;
    }
    resolved.push(part);
  }

  return resolved.length > 0 ? resolved.join('/') : null;
}

function findImageHrefs(value: unknown): string[] {
  if (Array.isArray(value)) {
    const hrefs: string[] = [];
    for (const child of value) {
      hrefs.push(...findImageHrefs(child));
    }
    return hrefs;
  }

  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const hrefs: string[] = [];

  for (const [key, child] of Object.entries(record)) {
    if (key === ':@') continue;
    const tag = key.toLowerCase().split(':').at(-1);
    if (tag === 'img' || tag === 'image') {
      const attrs = (record[':@'] as Record<string, unknown>) ?? {};
      const href = attr(attrs, '@_src') || attr(attrs, '@_href') || attr(attrs, '@_xlink:href');
      if (href) hrefs.push(href);
    }
    hrefs.push(...findImageHrefs(child));
  }

  return hrefs;
}

function parsePackage(opfXml: string): { parsed: OrderedNode[]; packageAttrs: Record<string, unknown>; packageContent: OrderedNode[] } | null {
  const parsed = parser.parse(opfXml) as OrderedNode[];
  const packageNode = parsed.find((node) => nodeLocalName(node) === 'package');
  if (!packageNode) return null;
  const packageTag = nodeTagName(packageNode);

  return {
    parsed,
    packageAttrs: nodeAttrs(packageNode),
    packageContent: (packageNode[packageTag] as OrderedNode[]) ?? [],
  };
}

function findSection(packageContent: OrderedNode[], names: readonly string[]): { node: OrderedNode; tag: string; content: OrderedNode[] } | null {
  for (const node of packageContent) {
    const tag = nodeTagName(node);
    if (names.includes(nodeLocalName(node))) return { node, tag, content: (node[tag] as OrderedNode[]) ?? [] };
  }
  return null;
}

function manifestItems(packageContent: OrderedNode[], opfDir: string): ManifestItem[] {
  const manifest = findSection(packageContent, ['manifest']);
  if (!manifest) return [];

  return manifest.content
    .filter((node) => nodeLocalName(node) === 'item')
    .map((node) => {
      const attrs = nodeAttrs(node);
      return { attrs, entryPath: resolveEntryPath(opfDir, attr(attrs, '@_href')) };
    });
}

function findManifestItemById(items: ManifestItem[], id: string): ManifestItem | null {
  return items.find((item) => attr(item.attrs, '@_id') === id) ?? null;
}

function findManifestItemByEntryPath(items: ManifestItem[], entryPath: string): ManifestItem | null {
  return items.find((item) => item.entryPath === entryPath) ?? null;
}

function isImage(mediaType: string): boolean {
  return mediaType.startsWith('image/');
}

function isCoverDocument(mediaType: string): boolean {
  return mediaType === 'application/xhtml+xml' || mediaType === 'image/svg+xml';
}

function coverMetaItem(packageContent: OrderedNode[], items: ManifestItem[]): ManifestItem | null {
  const metadata = findSection(packageContent, ['metadata', 'opf:metadata']);
  if (!metadata) return null;

  const coverMeta = metadata.content.find((node) => {
    if (nodeLocalName(node) !== 'meta') return false;
    return attr(nodeAttrs(node), '@_name').toLowerCase() === 'cover';
  });
  if (!coverMeta) return null;

  return findManifestItemById(items, attr(nodeAttrs(coverMeta), '@_content'));
}

function coverPropertyItem(items: ManifestItem[]): ManifestItem | null {
  return items.find((item) => attr(item.attrs, '@_properties').split(/\s+/).includes('cover-image')) ?? null;
}

function coverGuideItem(packageContent: OrderedNode[], items: ManifestItem[], opfDir: string): ManifestItem | null {
  const guide = findSection(packageContent, ['guide']);
  if (!guide) return null;

  for (const node of guide.content) {
    if (nodeLocalName(node) !== 'reference') continue;
    const attrs = nodeAttrs(node);
    if (attr(attrs, '@_type').trim().toLowerCase() !== 'cover') continue;
    const entryPath = resolveEntryPath(opfDir, attr(attrs, '@_href'));
    if (!entryPath) continue;
    const item = findManifestItemByEntryPath(items, entryPath);
    if (item) return item;
  }

  return null;
}

function fallbackCoverItem(items: ManifestItem[]): ManifestItem | null {
  return (
    items.find((item) => {
      const id = attr(item.attrs, '@_id').toLowerCase();
      return ['cover-image', 'cover', 'coverimg'].includes(id);
    }) ??
    items.find((item) => {
      const mediaType = attr(item.attrs, '@_media-type').toLowerCase();
      const href = attr(item.attrs, '@_href').toLowerCase();
      return isImage(mediaType) && href.includes('cover');
    }) ??
    null
  );
}

export interface CoverSlot {
  entryPath: string;
  mediaType: string;
  manifestItemId: string;
  document?: {
    entryPath: string;
    xml: string;
    imageHref: string;
  };
}

export interface CoverWriteResult {
  updatedOpfXml: string;
  newEntryPath: string;
  documentPatch?: {
    entryPath: string;
    xml: string;
  };
}

export type ReadTextEntry = (entryPath: string) => Promise<string>;

export async function locate(opfXml: string, opfDir: string, readTextEntry?: ReadTextEntry): Promise<CoverSlot | null> {
  const packageResult = parsePackage(opfXml);
  if (!packageResult) return null;

  const items = manifestItems(packageResult.packageContent, opfDir);
  const version = attr(packageResult.packageAttrs, '@_version');
  const orderedCandidates = version.startsWith('3')
    ? [coverPropertyItem(items), coverMetaItem(packageResult.packageContent, items), coverGuideItem(packageResult.packageContent, items, opfDir)]
    : [coverMetaItem(packageResult.packageContent, items), coverGuideItem(packageResult.packageContent, items, opfDir), coverPropertyItem(items)];
  orderedCandidates.push(fallbackCoverItem(items));

  for (const item of orderedCandidates) {
    if (!item?.entryPath) continue;
    const mediaType = attr(item.attrs, '@_media-type').toLowerCase();
    if (isImage(mediaType) && mediaType !== 'image/svg+xml') {
      return {
        entryPath: item.entryPath,
        mediaType,
        manifestItemId: attr(item.attrs, '@_id'),
      };
    }

    if (!readTextEntry || !isCoverDocument(mediaType)) continue;

    let documentXml: string;
    try {
      documentXml = await readTextEntry(item.entryPath);
    } catch {
      continue;
    }

    let referencedHrefs: string[];
    try {
      referencedHrefs = findImageHrefs(documentParser.parse(documentXml));
    } catch {
      continue;
    }

    for (const referencedHref of referencedHrefs) {
      const referencedPath = resolveEntryPath(entryDirectory(item.entryPath), referencedHref);
      if (!referencedPath) continue;
      const referencedItem = findManifestItemByEntryPath(items, referencedPath);
      if (!referencedItem) continue;

      const referencedMediaType = attr(referencedItem.attrs, '@_media-type').toLowerCase();
      if (isImage(referencedMediaType)) {
        return {
          entryPath: referencedPath,
          mediaType: referencedMediaType,
          manifestItemId: attr(referencedItem.attrs, '@_id'),
          document: { entryPath: item.entryPath, xml: documentXml, imageHref: referencedHref },
        };
      }
    }
  }

  return null;
}

function findManifestNodeById(packageContent: OrderedNode[], id: string): OrderedNode | null {
  const manifest = findSection(packageContent, ['manifest']);
  if (!manifest) return null;

  return manifest.content.find((node) => nodeLocalName(node) === 'item' && attr(nodeAttrs(node), '@_id') === id) ?? null;
}

function replaceEntryExtension(entryPath: string, extension: string): string {
  const separatorIndex = entryPath.lastIndexOf('/');
  const extensionIndex = entryPath.lastIndexOf('.');
  const stem = extensionIndex > separatorIndex ? entryPath.slice(0, extensionIndex) : entryPath;
  return `${stem}.${extension}`;
}

function chooseReplacementEntryPath(entryPath: string, extension: string, occupiedEntryPaths: readonly string[]): string {
  const preferred = replaceEntryExtension(entryPath, extension);
  if (preferred === entryPath) return entryPath;

  const occupied = new Set(occupiedEntryPaths.map((path) => path.toLowerCase()));
  if (!occupied.has(preferred.toLowerCase())) return preferred;

  const extensionIndex = preferred.lastIndexOf('.');
  const stem = preferred.slice(0, extensionIndex);
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${stem}-bookorbit-${suffix}.${extension}`;
    if (!occupied.has(candidate.toLowerCase())) return candidate;
  }
}

function encodeRelativeHref(fromDirectory: string, entryPath: string): string {
  const relativePath = posix.relative(fromDirectory || '.', entryPath);
  return relativePath
    .split('/')
    .map((segment) => (segment === '..' || segment === '.' ? segment : encodeURIComponent(segment)))
    .join('/');
}

function replaceImageReference(documentXml: string, oldHref: string, newHref: string): string | null {
  const xmlTokenPattern = /<!--[\s\S]*?-->|<(?:[\w.-]+:)?(?:img|image)\b[^>]*>/gi;
  const hrefPattern = /(\s(?:src|(?:[\w.-]+:)?href)\s*=\s*)(["'])([^"']*)(\2)/gi;
  let replaced = false;

  const updatedXml = documentXml.replace(xmlTokenPattern, (tag) => {
    if (replaced || tag.startsWith('<!--')) return tag;
    return tag.replace(hrefPattern, (match, prefix: string, quote: string, href: string) => {
      if (replaced || href !== oldHref) return match;
      replaced = true;
      return `${prefix}${quote}${newHref}${quote}`;
    });
  });

  return replaced ? updatedXml : null;
}

export function replace(
  opfXml: string,
  opfDir: string,
  slot: CoverSlot,
  image: EpubCoverImage,
  occupiedEntryPaths: readonly string[],
): CoverWriteResult | null {
  if (slot.mediaType === image.mediaType) {
    return { updatedOpfXml: opfXml, newEntryPath: slot.entryPath };
  }
  if (!slot.manifestItemId) return null;

  const packageResult = parsePackage(opfXml);
  if (!packageResult) return null;
  const manifestNode = findManifestNodeById(packageResult.packageContent, slot.manifestItemId);
  if (!manifestNode) return null;

  const newEntryPath = chooseReplacementEntryPath(slot.entryPath, image.extension, occupiedEntryPaths);
  let documentPatch: CoverWriteResult['documentPatch'];
  if (slot.document) {
    const newDocumentHref = encodeRelativeHref(entryDirectory(slot.document.entryPath), newEntryPath);
    const updatedDocumentXml = replaceImageReference(slot.document.xml, slot.document.imageHref, newDocumentHref);
    if (!updatedDocumentXml) return null;
    documentPatch = { entryPath: slot.document.entryPath, xml: updatedDocumentXml };
  }

  const manifestAttrs = nodeAttrs(manifestNode);
  manifestAttrs['@_href'] = encodeRelativeHref(opfDir, newEntryPath);
  manifestAttrs['@_media-type'] = image.mediaType;

  return {
    updatedOpfXml: String(builder.build(packageResult.parsed)),
    newEntryPath,
    documentPatch,
  };
}

function removeCoverDeclarations(packageContent: OrderedNode[]): void {
  const manifest = findSection(packageContent, ['manifest']);
  if (manifest) {
    for (const node of manifest.content) {
      if (nodeLocalName(node) !== 'item') continue;
      const attrs = nodeAttrs(node);
      const properties = attr(attrs, '@_properties')
        .split(/\s+/)
        .filter((property) => property && property !== 'cover-image');
      if (properties.length > 0) attrs['@_properties'] = properties.join(' ');
      else delete attrs['@_properties'];
    }
  }

  const metadata = findSection(packageContent, ['metadata', 'opf:metadata']);
  if (metadata) {
    metadata.node[metadata.tag] = metadata.content.filter(
      (node) => nodeLocalName(node) !== 'meta' || attr(nodeAttrs(node), '@_name').toLowerCase() !== 'cover',
    );
  }

  const guide = findSection(packageContent, ['guide']);
  if (guide) {
    guide.node[guide.tag] = guide.content.filter(
      (node) => nodeLocalName(node) !== 'reference' || attr(nodeAttrs(node), '@_type').trim().toLowerCase() !== 'cover',
    );
  }
}

function chooseCoverIdentity(
  items: ManifestItem[],
  opfDir: string,
  extension: string,
  occupiedEntryPaths: readonly string[],
): { id: string; href: string; entryPath: string } {
  const usedIds = new Set(items.map((item) => attr(item.attrs, '@_id')).filter(Boolean));
  const usedPaths = new Set(
    [...items.map((item) => item.entryPath), ...occupiedEntryPaths].filter((path): path is string => path !== null).map((path) => path.toLowerCase()),
  );

  for (let suffix = 0; ; suffix += 1) {
    const suffixText = suffix === 0 ? '' : `-${suffix + 1}`;
    const id = `${BOOKORBIT_COVER_ID}${suffixText}`;
    const href = `images/${BOOKORBIT_COVER_FILE}${suffixText}.${extension}`;
    const entryPath = resolveEntryPath(opfDir, href);
    if (entryPath && !usedIds.has(id) && !usedPaths.has(entryPath.toLowerCase())) return { id, href, entryPath };
  }
}

export function inject(opfXml: string, opfDir: string, image: EpubCoverImage, occupiedEntryPaths: readonly string[]): CoverWriteResult {
  const packageResult = parsePackage(opfXml);
  if (!packageResult) throw new Error('Cannot find <package> element in OPF');

  const version = attr(packageResult.packageAttrs, '@_version');
  if (!version.startsWith('2') && !version.startsWith('3')) throw new Error(`Unsupported EPUB version: "${version || '(missing)'}"`);

  const manifest = findSection(packageResult.packageContent, ['manifest']);
  const metadata = findSection(packageResult.packageContent, ['metadata', 'opf:metadata']);
  if (!manifest || !metadata) throw new Error('EPUB package must contain metadata and manifest sections');

  const items = manifestItems(packageResult.packageContent, opfDir);
  const identity = chooseCoverIdentity(items, opfDir, image.extension, occupiedEntryPaths);
  removeCoverDeclarations(packageResult.packageContent);

  const itemAttrs: Record<string, unknown> = {
    '@_id': identity.id,
    '@_href': identity.href,
    '@_media-type': image.mediaType,
  };
  if (version.startsWith('3')) itemAttrs['@_properties'] = 'cover-image';
  manifest.content.push({ [childTag(manifest.tag, 'item')]: [], ':@': itemAttrs });

  if (version.startsWith('2')) {
    const currentMetadata = (metadata.node[metadata.tag] as OrderedNode[]) ?? [];
    currentMetadata.push({ [childTag(metadata.tag, 'meta')]: [], ':@': { '@_name': 'cover', '@_content': identity.id } });
  }

  return {
    updatedOpfXml: String(builder.build(packageResult.parsed)),
    newEntryPath: identity.entryPath,
  };
}
