import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { stat } from 'fs/promises';
import * as unzipper from 'unzipper';
import { XMLParser } from 'fast-xml-parser';

import type { EpubBookInfo, EpubManifestItem, EpubSpineItem, EpubTocItem } from '@projectx/types';
import { BookReadService } from '../../book/book-read.service';
import { LibraryService } from '../../library/library.service';
import type { RequestUser } from '../../../common/types/request-user';

const CONTENT_TYPES: Record<string, string> = {
  '.xhtml': 'application/xhtml+xml',
  '.html': 'application/xhtml+xml',
  '.htm': 'application/xhtml+xml',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.xml': 'application/xml',
  '.ncx': 'application/x-dtbncx+xml',
  '.opf': 'application/oebps-package+xml',
  '.smil': 'application/smil+xml',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

const MAX_CACHE = 50;
const OPTIONAL_META_INF_FILES = [
  'META-INF/encryption.xml',
  'META-INF/com.apple.ibooks.display-options.xml',
  'META-INF/com.kobobooks.display-options.xml',
  'META-INF/calibre_bookmarks.txt',
] as const;

interface CacheEntry {
  info: EpubBookInfo;
  mtime: number;
  validPaths: Set<string>;
  lastAccessed: number;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
});

function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function getText(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  if (v != null && typeof v === 'object') {
    const text = (v as Record<string, unknown>)['#text'];
    if (typeof text === 'string') return text.trim() || null;
    if (typeof text === 'number') return String(text);
  }
  return null;
}

function findInZip(files: unzipper.File[], path: string): unzipper.File | undefined {
  const clean = normalizeZipPath(path);
  const cleanLower = clean.toLowerCase();
  let ciMatch: unzipper.File | undefined;
  for (const file of files) {
    const fp = normalizeZipPath(file.path);
    if (fp === clean) return file;
    if (!ciMatch && fp.toLowerCase() === cleanLower) ciMatch = file;
  }
  return ciMatch;
}

function safeDecodeURI(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

function normalizeZipPath(path: string): string {
  const clean = safeDecodeURI((path ?? '').replace(/\\/g, '/')).replace(/^\/+/, '');
  const parts = clean.split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (resolved.length > 0) resolved.pop();
      continue;
    }
    resolved.push(part);
  }
  return resolved.join('/');
}

function resolveHref(href: string, basePath: string): string {
  if (!href || /^[a-z][a-z\d+.-]*:/i.test(href)) return href;
  const decoded = safeDecodeURI(href);
  const [pathWithQuery, fragment] = decoded.split('#');
  const path = pathWithQuery.split('?')[0];
  const resolvedPath = path.startsWith('/') ? normalizeZipPath(path) : normalizeZipPath(basePath + path);
  return fragment ? `${resolvedPath}#${fragment}` : resolvedPath;
}

function guessContentType(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return 'application/octet-stream';
  return CONTENT_TYPES[path.slice(dot).toLowerCase()] ?? 'application/octet-stream';
}

function parseNavOl(ol: Record<string, unknown>, basePath: string): EpubTocItem[] {
  return toArray(ol?.li)
    .map((li: Record<string, unknown>) => {
      const a = li?.a as Record<string, unknown> | string | undefined;
      let label = '';
      let href: string | undefined;

      if (typeof a === 'string') {
        label = a.trim();
      } else if (a != null) {
        label = getText(a) ?? getText(a.span) ?? '';
        const rawHref = a['@_href'] as string | undefined;
        if (rawHref && !rawHref.startsWith('http')) href = resolveHref(rawHref, basePath);
        else href = rawHref;
      }

      const nestedOl = li?.ol as Record<string, unknown> | undefined;
      const children = nestedOl ? parseNavOl(nestedOl, basePath) : undefined;

      return { label, href, children: children?.length ? children : undefined } satisfies EpubTocItem;
    })
    .filter((item) => item.label.length > 0);
}

function parseNcxNavPoints(parent: Record<string, unknown>, basePath: string): EpubTocItem[] {
  return toArray(parent?.navPoint)
    .map((np: Record<string, unknown>) => {
      const navLabel = np?.navLabel as Record<string, unknown> | undefined;
      const label = getText(navLabel?.text) ?? '';

      const content = np?.content as Record<string, string> | undefined;
      let href = content?.['@_src'];
      if (href && !href.startsWith('http')) href = resolveHref(href, basePath);

      const children = parseNcxNavPoints(np, basePath);
      return { label, href, children: children.length ? children : undefined } satisfies EpubTocItem;
    })
    .filter((item) => item.label.length > 0);
}

async function parseEpub(epubPath: string): Promise<EpubBookInfo> {
  const zip = await unzipper.Open.file(epubPath);

  const containerEntry = findInZip(zip.files, 'META-INF/container.xml');
  if (!containerEntry) throw new Error('Missing META-INF/container.xml');
  const containerDoc = xmlParser.parse(await containerEntry.buffer()) as Record<string, unknown>;

  const container = containerDoc['container'] as Record<string, unknown>;
  const rootfiles = (container?.rootfiles as Record<string, unknown>)?.rootfile;
  const rootfile: unknown = Array.isArray(rootfiles) ? rootfiles[0] : rootfiles;
  const opfPath = (rootfile as Record<string, string>)?.['@_full-path'];
  if (!opfPath) throw new Error('Cannot find OPF path in container.xml');

  const rootPath = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

  const opfEntry = findInZip(zip.files, opfPath);
  if (!opfEntry) throw new Error(`OPF not found: ${opfPath}`);
  const opfDoc = xmlParser.parse(await opfEntry.buffer()) as Record<string, unknown>;
  const pkg = (opfDoc['package'] ?? opfDoc) as Record<string, unknown>;
  const manifestEl = pkg['manifest'] as Record<string, unknown> | undefined;
  const spineEl = pkg['spine'] as Record<string, unknown> | undefined;
  const metadataEl = pkg['metadata'] as Record<string, unknown> | undefined;

  const manifestById = new Map<string, EpubManifestItem>();
  const manifest: EpubManifestItem[] = toArray(manifestEl?.item).map((item: Record<string, string>) => {
    const id = item['@_id'];
    const relHref = item['@_href'];
    const mediaType = item['@_media-type'] ?? 'application/octet-stream';
    const propertiesStr = item['@_properties'];
    const properties = propertiesStr ? propertiesStr.split(/\s+/) : undefined;
    const fullHref = normalizeZipPath(resolveHref(relHref, rootPath).split('#')[0]);
    const size = findInZip(zip.files, fullHref)?.uncompressedSize ?? 0;
    const manifestItem: EpubManifestItem = { id, href: fullHref, mediaType, size, ...(properties ? { properties } : {}) };
    manifestById.set(id, manifestItem);
    return manifestItem;
  });

  const spine: EpubSpineItem[] = toArray(spineEl?.itemref).reduce<EpubSpineItem[]>((acc, itemref: Record<string, string>) => {
    const idref = itemref['@_idref'];
    const m = manifestById.get(idref);
    if (m) acc.push({ idref, href: m.href, mediaType: m.mediaType, linear: itemref['@_linear'] !== 'no' });
    return acc;
  }, []);

  const metadata: Record<string, unknown> = {};
  if (metadataEl) {
    const title = getText(metadataEl['dc:title']);
    const creator = getText(toArray(metadataEl['dc:creator'])[0]);
    const language = getText(metadataEl['dc:language']);
    const publisher = getText(metadataEl['dc:publisher']);
    const description = getText(metadataEl['dc:description']);
    const identifier = getText(toArray(metadataEl['dc:identifier'])[0]);
    if (title) metadata.title = title;
    if (creator) metadata.creator = creator;
    if (language) metadata.language = language;
    if (publisher) metadata.publisher = publisher;
    if (description) metadata.description = description;
    if (identifier) metadata.identifier = identifier;
  }

  let coverPath: string | null = manifest.find((m) => m.properties?.includes('cover-image'))?.href ?? null;
  if (!coverPath && metadataEl) {
    const coverMeta = toArray(metadataEl['meta']).find((m: Record<string, string>) => m['@_name'] === 'cover');
    if (coverMeta) coverPath = manifestById.get((coverMeta as Record<string, string>)['@_content'])?.href ?? null;
  }

  let toc: EpubTocItem | null = null;

  const navItem = manifest.find((m) => m.properties?.includes('nav'));
  if (navItem) {
    try {
      const navEntry = findInZip(zip.files, navItem.href);
      if (navEntry) {
        const navDoc = xmlParser.parse(await navEntry.buffer()) as Record<string, unknown>;
        const navDir = navItem.href.includes('/') ? navItem.href.slice(0, navItem.href.lastIndexOf('/') + 1) : rootPath;
        const html = (navDoc['html'] ?? navDoc) as Record<string, unknown>;
        const body = html['body'] as Record<string, unknown> | undefined;
        const navs = toArray(body?.nav);
        const tocNav = (navs.find((n: Record<string, unknown>) => {
          const type = n['@_epub:type'] ?? n['@_type'];
          return typeof type === 'string' && type.split(/\s+/).includes('toc');
        }) ?? navs[0]) as Record<string, unknown> | undefined;
        if (tocNav) {
          const ol = tocNav['ol'] as Record<string, unknown> | undefined;
          if (ol) toc = { label: 'Table of Contents', children: parseNavOl(ol, navDir) };
        }
      }
    } catch {
      // fall through to NCX
    }
  }

  if (!toc) {
    const ncxItem = manifest.find((m) => m.mediaType === 'application/x-dtbncx+xml');
    if (ncxItem) {
      try {
        const ncxEntry = findInZip(zip.files, ncxItem.href);
        if (ncxEntry) {
          const ncxDoc = xmlParser.parse(await ncxEntry.buffer()) as Record<string, unknown>;
          const ncxDir = ncxItem.href.includes('/') ? ncxItem.href.slice(0, ncxItem.href.lastIndexOf('/') + 1) : rootPath;
          const ncx = (ncxDoc['ncx'] ?? ncxDoc) as Record<string, unknown>;
          const navMap = ncx['navMap'] as Record<string, unknown> | undefined;
          if (navMap) toc = { label: 'Table of Contents', children: parseNcxNavPoints(navMap, ncxDir) };
        }
      } catch {
        // TOC unavailable
      }
    }
  }

  const optionalFiles = OPTIONAL_META_INF_FILES.filter((path) => findInZip(zip.files, path));

  return { containerPath: opfPath, rootPath, spine, manifest, optionalFiles, toc, metadata, coverPath };
}

@Injectable()
export class EpubService {
  private readonly logger = new Logger(EpubService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly bookReadService: BookReadService,
    private readonly libraryService: LibraryService,
  ) {}

  async getBookInfo(bookId: number, fileId: number | undefined, user: RequestUser): Promise<EpubBookInfo> {
    const epubPath = await this.resolveEpubPath(bookId, fileId, user);
    return (await this.getCachedEntry(epubPath)).info;
  }

  async streamFile(
    bookId: number,
    filePath: string,
    fileId: number | undefined,
    user: RequestUser,
  ): Promise<{ stream: NodeJS.ReadableStream; contentType: string; size: number }> {
    if (filePath.includes('..')) throw new ForbiddenException('Invalid path');
    const normalizedPath = normalizeZipPath(filePath);
    if (!normalizedPath) throw new ForbiddenException('Invalid path');

    const epubPath = await this.resolveEpubPath(bookId, fileId, user);
    const cached = await this.getCachedEntry(epubPath);
    const zip = await unzipper.Open.file(epubPath);
    const entry = findInZip(zip.files, normalizedPath);
    if (!entry) throw new NotFoundException(`Entry not in archive: ${normalizedPath}`);

    const manifestItem = cached.info.manifest.find((m) => m.href === normalizedPath);
    const contentType = manifestItem?.mediaType ?? guessContentType(normalizedPath);

    return { stream: entry.stream(), contentType, size: entry.uncompressedSize };
  }

  private async resolveEpubPath(bookId: number, fileId: number | undefined, user: RequestUser): Promise<string> {
    const libraryId = await this.bookReadService.findLibraryIdByBookId(bookId);
    if (libraryId === null) throw new NotFoundException(`Book ${bookId} not found`);
    await this.libraryService.verifyUserAccess(user.id, libraryId, user.isSuperuser);

    if (fileId != null) {
      const file = await this.bookReadService.findFileById(fileId);
      if (!file || file.bookId !== bookId) throw new NotFoundException(`File ${fileId} not found for book ${bookId}`);
      if (file.format !== 'epub') throw new NotFoundException(`File ${fileId} is not an EPUB file`);
      return file.absolutePath;
    }

    const [file] = await this.bookReadService.findPrimaryFilesByBookIds([bookId]);
    if (!file || file.format !== 'epub') throw new NotFoundException(`No primary EPUB file for book ${bookId}`);
    return file.absolutePath;
  }

  private async getCachedEntry(epubPath: string): Promise<CacheEntry> {
    const { mtimeMs } = await stat(epubPath);
    const cached = this.cache.get(epubPath);
    if (cached && cached.mtime === mtimeMs) {
      cached.lastAccessed = Date.now();
      return cached;
    }

    this.logger.debug(`Parsing EPUB: ${epubPath}`);
    const info = await parseEpub(epubPath);

    const validPaths = new Set<string>(['META-INF/container.xml', normalizeZipPath(info.containerPath)]);
    for (const item of info.manifest) validPaths.add(normalizeZipPath(item.href));

    const entry: CacheEntry = { info, mtime: mtimeMs, validPaths, lastAccessed: Date.now() };
    this.evict();
    this.cache.set(epubPath, entry);
    return entry;
  }

  private evict(): void {
    if (this.cache.size < MAX_CACHE) return;
    const oldest = [...this.cache.entries()].sort((a, b) => a[1].lastAccessed - b[1].lastAccessed)[0];
    if (oldest) this.cache.delete(oldest[0]);
  }
}
