import { XMLParser, XMLBuilder } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: false,
  preserveOrder: true,
  isArray: (name) => ['item', 'meta', 'reference'].includes(name),
  textNodeName: '#text',
  allowBooleanAttributes: true,
});

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  textNodeName: '#text',
});

type OrderedNode = Record<string, unknown>;

function attr(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === 'string' ? v : '';
}

function nodeTagName(node: OrderedNode): string {
  return Object.keys(node).find((k) => k !== ':@') ?? '';
}

export interface CoverSlot {
  entryPath: string;
  mediaType: string;
}

export interface CoverInjectResult {
  updatedOpfXml: string;
  newEntryPath: string;
}

function detectMimeFromBytes(bytes: Buffer): { mime: string; ext: string } {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { mime: 'image/png', ext: 'png' };
  return { mime: 'image/jpeg', ext: 'jpg' };
}

function resolvePath(opfDir: string, href: string): string {
  const parts = (opfDir + href).split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '..') resolved.pop();
    else if (part !== '.') resolved.push(part);
  }
  return resolved.join('/');
}

export function locate(opfXml: string, opfDir: string): CoverSlot | null {
  const parsed = parser.parse(opfXml) as OrderedNode[];

  let pkgNode: OrderedNode | null = null;
  for (const node of parsed) {
    if ('package' in node) {
      pkgNode = node;
      break;
    }
  }
  if (!pkgNode) return null;

  const pkgContent = pkgNode['package'] as OrderedNode[];
  let manifestItems: Record<string, unknown>[] = [];
  let metaMetas: Record<string, unknown>[] = [];

  for (const node of pkgContent) {
    const tag = nodeTagName(node);
    if (tag === 'manifest') {
      manifestItems = (node['manifest'] as OrderedNode[])
        .filter((n) => nodeTagName(n) === 'item')
        .map((n) => (n[':@'] as Record<string, unknown>) ?? {});
    }
    if (tag === 'metadata' || tag === 'opf:metadata') {
      metaMetas = (node[tag] as OrderedNode[]).filter((n) => nodeTagName(n) === 'meta').map((n) => (n[':@'] as Record<string, unknown>) ?? {});
    }
  }

  // Strategy 1: meta[name="cover"] → manifest item by id (EPUB2 — what Calibre/readers follow)
  const coverMeta = metaMetas.find((m) => attr(m, '@_name').toLowerCase() === 'cover');
  if (coverMeta) {
    const coverId = attr(coverMeta, '@_content');
    const item = manifestItems.find((i) => attr(i, '@_id') === coverId);
    if (item) {
      const mt = attr(item, '@_media-type').toLowerCase();
      if (mt.startsWith('image/')) {
        return { entryPath: resolvePath(opfDir, decodeURIComponent(attr(item, '@_href'))), mediaType: mt };
      }
    }
  }

  // Strategy 2: properties="cover-image" (EPUB3)
  const epub3Cover = manifestItems.find((i) => {
    const props = attr(i, '@_properties');
    return props.split(/\s+/).includes('cover-image');
  });
  if (epub3Cover) {
    return {
      entryPath: resolvePath(opfDir, decodeURIComponent(attr(epub3Cover, '@_href'))),
      mediaType: attr(epub3Cover, '@_media-type'),
    };
  }

  // Strategy 3: exact id match fallback (cover-image, cover, coverimg)
  const byId = manifestItems.find((i) => {
    const id = attr(i, '@_id').toLowerCase();
    const mt = attr(i, '@_media-type').toLowerCase();
    return mt.startsWith('image/') && (id === 'cover-image' || id === 'cover' || id === 'coverimg');
  });
  if (byId) {
    return {
      entryPath: resolvePath(opfDir, decodeURIComponent(attr(byId, '@_href'))),
      mediaType: attr(byId, '@_media-type'),
    };
  }

  return null;
}

export function inject(opfXml: string, opfDir: string, coverBytes: Buffer): CoverInjectResult {
  const { mime, ext } = detectMimeFromBytes(coverBytes);
  const newEntryPath = `${opfDir}images/cover.${ext}`;
  const relHref = newEntryPath.startsWith(opfDir) ? newEntryPath.slice(opfDir.length) : newEntryPath;

  const parsed = parser.parse(opfXml) as OrderedNode[];

  for (const topNode of parsed) {
    if (!('package' in topNode)) continue;
    const pkgContent = topNode['package'] as OrderedNode[];

    // Add cover-image manifest item
    for (const node of pkgContent) {
      const tag = nodeTagName(node);
      if (tag === 'manifest') {
        const manifestContent = node['manifest'] as OrderedNode[];
        manifestContent.push({
          item: [],
          ':@': { '@_id': 'cover-image', '@_href': relHref, '@_media-type': mime, '@_properties': 'cover-image' },
        } as OrderedNode);
      }
      // Add <meta name="cover" content="cover-image"/> to metadata for EPUB2 compat
      if (tag === 'metadata' || tag === 'opf:metadata') {
        const metaContent = node[tag] as OrderedNode[];
        metaContent.push({ meta: [], ':@': { '@_name': 'cover', '@_content': 'cover-image' } } as OrderedNode);
      }
    }
    break;
  }

  const updatedOpfXml = String(builder.build(parsed));
  return { updatedOpfXml, newEntryPath };
}
