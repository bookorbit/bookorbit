import * as unzipper from 'unzipper';
import { XMLParser } from 'fast-xml-parser';

import type {
  EpubBookInfo,
  EpubMediaOverlayCapability,
  EpubMediaOverlayPlaylist,
  EpubMediaOverlayPlaylistItem,
  EpubMediaOverlayPlaylistSection,
  EpubTocItem,
} from '@bookorbit/types';

const smilParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
});

function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function safeDecodeURI(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

export function normalizeEpubZipPath(path: string): string {
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

export function resolveEpubHref(href: string, basePath: string): string {
  if (!href || /^[a-z][a-z\d+.-]*:/i.test(href)) return href;
  const decoded = safeDecodeURI(href);
  const [pathWithQuery, fragment] = decoded.split('#');
  const path = pathWithQuery.split('?')[0];
  const resolvedPath = path.startsWith('/') ? normalizeEpubZipPath(path) : normalizeEpubZipPath(basePath + path);
  return fragment ? `${resolvedPath}#${fragment}` : resolvedPath;
}

function zipDir(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
}

export function findEpubZipEntry(files: unzipper.File[], path: string): unzipper.File | undefined {
  const clean = normalizeEpubZipPath(path);
  const cleanLower = clean.toLowerCase();
  let ciMatch: unzipper.File | undefined;
  for (const file of files) {
    const fp = normalizeEpubZipPath(file.path);
    if (fp === clean) return file;
    if (!ciMatch && fp.toLowerCase() === cleanLower) ciMatch = file;
  }
  return ciMatch;
}

function parseClock(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim().replace(/^npt=/i, '');

  const unit = raw.match(/^([+-]?\d+(?:\.\d+)?)(ms|s|min|h)$/i);
  if (unit) {
    const n = Number(unit[1]);
    if (!Number.isFinite(n) || n < 0) return null;
    const suffix = unit[2].toLowerCase();
    if (suffix === 'ms') return n / 1000;
    if (suffix === 'min') return n * 60;
    if (suffix === 'h') return n * 3600;
    return n;
  }

  const parts = raw.split(':').map(Number);
  if (parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

function collectPars(node: unknown, acc: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    for (const child of node) collectPars(child, acc);
    return acc;
  }
  if (typeof node !== 'object' || node === null) return acc;
  const obj = node as Record<string, unknown>;
  if (obj.text != null && obj.audio != null) acc.push(obj);
  for (const value of Object.values(obj)) collectPars(value, acc);
  return acc;
}

function attr(node: unknown, name: string): string | null {
  if (typeof node !== 'object' || node === null) return null;
  const value = (node as Record<string, unknown>)[`@_${name}`];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function splitHrefFragment(href: string): { href: string; fragment: string | null } {
  const [path, fragment] = href.split('#');
  return { href: normalizeEpubZipPath(path), fragment: fragment || null };
}

async function parseEpubMediaOverlayBookInfo(epubPath: string): Promise<EpubBookInfo> {
  const zip = await unzipper.Open.file(epubPath);
  const containerEntry = findEpubZipEntry(zip.files, 'META-INF/container.xml');
  if (!containerEntry) throw new Error('Missing META-INF/container.xml');

  const containerDoc = smilParser.parse(await containerEntry.buffer()) as Record<string, unknown>;
  const container = containerDoc['container'] as Record<string, unknown>;
  const rootfiles = (container?.rootfiles as Record<string, unknown>)?.rootfile;
  const rootfile: unknown = Array.isArray(rootfiles) ? rootfiles[0] : rootfiles;
  const opfPath = (rootfile as Record<string, string>)?.['@_full-path'];
  if (!opfPath) throw new Error('Cannot find OPF path in container.xml');

  const rootPath = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const opfEntry = findEpubZipEntry(zip.files, opfPath);
  if (!opfEntry) throw new Error(`OPF not found: ${opfPath}`);

  const opfDoc = smilParser.parse(await opfEntry.buffer()) as Record<string, unknown>;
  const pkg = (opfDoc['package'] ?? opfDoc) as Record<string, unknown>;
  const manifestEl = pkg['manifest'] as Record<string, unknown> | undefined;
  const spineEl = pkg['spine'] as Record<string, unknown> | undefined;

  const manifestById = new Map<string, EpubBookInfo['manifest'][number]>();
  const manifest = toArray(manifestEl?.item as Record<string, unknown>[]).reduce<EpubBookInfo['manifest']>((acc, item) => {
    const id = item['@_id'];
    const relHref = item['@_href'];
    if (typeof id !== 'string' || typeof relHref !== 'string') return acc;

    const fullHref = normalizeEpubZipPath(resolveEpubHref(relHref, rootPath).split('#')[0]);
    const propertiesStr = item['@_properties'];
    const mediaOverlay = item['@_media-overlay'];
    const manifestItem = {
      id,
      href: fullHref,
      mediaType: typeof item['@_media-type'] === 'string' ? item['@_media-type'] : 'application/octet-stream',
      size: findEpubZipEntry(zip.files, fullHref)?.uncompressedSize ?? 0,
      ...(typeof propertiesStr === 'string' && propertiesStr ? { properties: propertiesStr.split(/\s+/) } : {}),
      ...(typeof mediaOverlay === 'string' && mediaOverlay ? { mediaOverlay } : {}),
    };
    manifestById.set(id, manifestItem);
    acc.push(manifestItem);
    return acc;
  }, []);

  const spine = toArray(spineEl?.itemref as Record<string, unknown>[]).reduce<EpubBookInfo['spine']>((acc, itemref) => {
    const idref = itemref['@_idref'];
    if (typeof idref !== 'string') return acc;
    const item = manifestById.get(idref);
    if (!item) return acc;
    acc.push({
      idref,
      href: item.href,
      mediaType: item.mediaType,
      linear: itemref['@_linear'] !== 'no',
    });
    return acc;
  }, []);

  return {
    containerPath: opfPath,
    rootPath,
    spine,
    manifest,
    toc: null,
    metadata: {},
    coverPath: null,
  };
}

function flattenTocLabels(toc: EpubTocItem | null): Map<string, string> {
  const labels = new Map<string, string>();
  const visit = (item: EpubTocItem) => {
    if (item.href) {
      const key = splitHrefFragment(item.href).href;
      if (key && !labels.has(key)) labels.set(key, item.label);
    }
    for (const child of item.children ?? []) visit(child);
  };
  if (toc) visit(toc);
  return labels;
}

async function parseSmilItems(
  zip: unzipper.CentralDirectory,
  smilHref: string,
): Promise<
  Array<{
    textHref: string;
    textFragment: string | null;
    audioHref: string;
    clipBeginSeconds: number;
    clipEndSeconds: number | null;
    durationSeconds: number | null;
  }>
> {
  const entry = findEpubZipEntry(zip.files, smilHref);
  if (!entry) return [];
  const smilDir = zipDir(smilHref);
  const doc = smilParser.parse(await entry.buffer()) as Record<string, unknown>;
  return collectPars(doc)
    .map((par) => {
      const textSrc = attr(par.text, 'src');
      const audioSrc = attr(par.audio, 'src');
      if (!textSrc || !audioSrc) return null;
      const text = splitHrefFragment(resolveEpubHref(textSrc, smilDir));
      const audio = splitHrefFragment(resolveEpubHref(audioSrc, smilDir));
      const begin = parseClock(attr(par.audio, 'clipBegin')) ?? 0;
      const end = parseClock(attr(par.audio, 'clipEnd'));
      const duration = end != null && end >= begin ? end - begin : null;
      return {
        textHref: text.href,
        textFragment: text.fragment,
        audioHref: audio.href,
        clipBeginSeconds: begin,
        clipEndSeconds: end,
        durationSeconds: duration,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item != null);
}

export async function buildEpubMediaOverlayPlaylist(
  epubPath: string,
  info: EpubBookInfo,
  bookId: number,
  fileId: number | null,
): Promise<EpubMediaOverlayPlaylist> {
  const manifestById = new Map(info.manifest.map((item) => [item.id, item]));
  const manifestByHref = new Map(info.manifest.map((item) => [item.href, item]));
  const tocLabels = flattenTocLabels(info.toc);
  const zip = await unzipper.Open.file(epubPath);

  const items: EpubMediaOverlayPlaylistItem[] = [];
  const sections: EpubMediaOverlayPlaylistSection[] = [];
  const audioHrefs = new Set<string>();
  let totalKnownDuration = 0;
  let hasUnknownDuration = false;

  for (let sectionIndex = 0; sectionIndex < info.spine.length; sectionIndex += 1) {
    const spineItem = info.spine[sectionIndex];
    if (!spineItem) continue;
    const manifestItem = manifestById.get(spineItem.idref);
    const overlayId = manifestItem?.mediaOverlay;
    if (!overlayId) continue;
    const overlay = manifestById.get(overlayId);
    if (!overlay) continue;

    const sectionStart = totalKnownDuration;
    let sectionDuration: number | null = 0;
    const smilItems = await parseSmilItems(zip, overlay.href);
    for (const smilItem of smilItems) {
      const audioManifest = manifestByHref.get(smilItem.audioHref);
      audioHrefs.add(smilItem.audioHref);
      if (smilItem.durationSeconds == null) {
        hasUnknownDuration = true;
        sectionDuration = null;
      } else {
        totalKnownDuration += smilItem.durationSeconds;
        if (sectionDuration != null) sectionDuration += smilItem.durationSeconds;
      }
      items.push({
        index: items.length,
        sectionIndex,
        smilHref: overlay.href,
        textHref: smilItem.textHref,
        textFragment: smilItem.textFragment,
        audioHref: smilItem.audioHref,
        audioMimeType: audioManifest?.mediaType ?? 'application/octet-stream',
        clipBeginSeconds: smilItem.clipBeginSeconds,
        clipEndSeconds: smilItem.clipEndSeconds,
        durationSeconds: smilItem.durationSeconds,
        label: tocLabels.get(smilItem.textHref) ?? tocLabels.get(spineItem.href) ?? null,
      });
    }

    if (smilItems.length > 0) {
      sections.push({
        index: sectionIndex,
        href: spineItem.href,
        label: tocLabels.get(spineItem.href) ?? null,
        smilHref: overlay.href,
        startSeconds: sectionStart,
        durationSeconds: sectionDuration,
      });
    }
  }

  const resources = [...audioHrefs].map((href) => {
    const manifestItem = manifestByHref.get(href);
    return {
      href,
      mediaType: manifestItem?.mediaType ?? 'application/octet-stream',
      size: manifestItem?.size ?? findEpubZipEntry(zip.files, href)?.uncompressedSize ?? 0,
    };
  });

  return {
    bookId,
    fileId,
    durationSeconds: hasUnknownDuration ? null : totalKnownDuration,
    items,
    sections,
    resources,
  };
}

export async function buildEpubMediaOverlayPlaylistFromFile(
  epubPath: string,
  bookId: number,
  fileId: number | null,
): Promise<EpubMediaOverlayPlaylist> {
  const info = await parseEpubMediaOverlayBookInfo(epubPath);
  return buildEpubMediaOverlayPlaylist(epubPath, info, bookId, fileId);
}

export async function inspectEpubMediaOverlay(epubPath: string, info: EpubBookInfo): Promise<EpubMediaOverlayCapability> {
  const playlist = await buildEpubMediaOverlayPlaylist(epubPath, info, 0, null);
  return {
    available: playlist.items.length > 0,
    durationSeconds: playlist.durationSeconds,
  };
}

export async function inspectEpubMediaOverlayFile(epubPath: string): Promise<EpubMediaOverlayCapability> {
  const zip = await unzipper.Open.file(epubPath);
  const containerEntry = findEpubZipEntry(zip.files, 'META-INF/container.xml');
  if (!containerEntry) return { available: false, durationSeconds: null };

  const containerDoc = smilParser.parse(await containerEntry.buffer()) as Record<string, unknown>;
  const container = containerDoc['container'] as Record<string, unknown>;
  const rootfiles = (container?.rootfiles as Record<string, unknown>)?.rootfile;
  const rootfile: unknown = Array.isArray(rootfiles) ? rootfiles[0] : rootfiles;
  const opfPath = (rootfile as Record<string, string>)?.['@_full-path'];
  if (!opfPath) return { available: false, durationSeconds: null };

  const rootPath = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const opfEntry = findEpubZipEntry(zip.files, opfPath);
  if (!opfEntry) return { available: false, durationSeconds: null };

  const opfDoc = smilParser.parse(await opfEntry.buffer()) as Record<string, unknown>;
  const pkg = (opfDoc['package'] ?? opfDoc) as Record<string, unknown>;
  const manifestEl = pkg['manifest'] as Record<string, unknown> | undefined;
  const spineEl = pkg['spine'] as Record<string, unknown> | undefined;

  const manifestById = new Map<string, EpubBookInfo['manifest'][number]>();
  const manifest = toArray(manifestEl?.item as any).map((item: any) => {
    const id = item['@_id'];
    const relHref = item['@_href'];
    const mediaType = item['@_media-type'] ?? 'application/octet-stream';
    const propertiesStr = item['@_properties'];
    const properties = propertiesStr ? propertiesStr.split(/\s+/) : undefined;
    const mediaOverlay = item['@_media-overlay'];
    const fullHref = normalizeEpubZipPath(resolveEpubHref(relHref, rootPath).split('#')[0]);
    const manifestItem = {
      id,
      href: fullHref,
      mediaType,
      size: findEpubZipEntry(zip.files, fullHref)?.uncompressedSize ?? 0,
      ...(properties ? { properties } : {}),
      ...(typeof mediaOverlay === 'string' && mediaOverlay ? { mediaOverlay } : {}),
    };
    manifestById.set(id, manifestItem);
    return manifestItem;
  });
  const spine = toArray(spineEl?.itemref as any).reduce<EpubBookInfo['spine']>((acc, itemref: any) => {
    const idref = itemref['@_idref'];
    const manifestItem = manifestById.get(idref);
    if (manifestItem) acc.push({ idref, href: manifestItem.href, mediaType: manifestItem.mediaType, linear: itemref['@_linear'] !== 'no' });
    return acc;
  }, []);

  const info: EpubBookInfo = {
    containerPath: opfPath,
    rootPath,
    spine,
    manifest,
    optionalFiles: [],
    toc: null,
    metadata: {},
    coverPath: null,
  };
  return inspectEpubMediaOverlay(epubPath, info);
}
