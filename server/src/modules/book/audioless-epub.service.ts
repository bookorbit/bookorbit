import { createWriteStream } from 'fs';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { ZipArchive, type Archiver } from 'archiver';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import type { Readable } from 'stream';
import * as unzipper from 'unzipper';

import { audiolessEpubConfig } from '../../config/config';
import { buildEpubMediaOverlayPlaylistFromFile, findEpubZipEntry, normalizeEpubZipPath, resolveEpubHref } from '../reader/epub/epub-media-overlay';

const opfParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: false,
  preserveOrder: true,
  isArray: (name) => ['item', 'itemref', 'meta', 'link', 'reference'].includes(name),
  textNodeName: '#text',
  allowBooleanAttributes: true,
});

const opfBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  textNodeName: '#text',
  suppressBooleanAttributes: false,
});

type OrderedNode = Record<string, unknown>;

/**
 * KOReader fingerprints a book by hashing 1 KB blocks from fixed offsets, and offset 0 covers the
 * first local file header, timestamp included. Stamping every entry with the DOS epoch keeps the
 * rebuilt archive byte-identical across downloads so a device keeps the same document identity.
 */
const ZIP_ENTRY_DATE = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));

const STORYTELLER_SPAN_RESET = `

/* BookOrbit: Storyteller wraps synced sentences in spans. Some source EPUBs
   style all spans globally, so keep those generated sync anchors visually neutral. */
span[id^="text"][id*="-s"] {
  font-size: inherit;
}
`;

export type AudiolessEpubResult = {
  removedEntries: number;
  sanitizedEntries: number;
};

export type AudiolessEpubArchive = AudiolessEpubResult & {
  archive: ZipArchive;
};

/**
 * Entries read into memory are bounded by their declared size before a single byte is inflated,
 * so a crafted archive cannot turn a package document into an out-of-memory crash.
 */
async function readBoundedEntry(entry: unzipper.File, maxBytes: number, label: string): Promise<Buffer> {
  if (entry.uncompressedSize > maxBytes) {
    throw new BadRequestException(`Invalid EPUB: ${label} is ${entry.uncompressedSize} bytes, over the ${maxBytes} byte limit`);
  }
  const buffer = await entry.buffer();
  if (buffer.length > maxBytes) {
    throw new BadRequestException(`Invalid EPUB: ${label} is ${buffer.length} bytes, over the ${maxBytes} byte limit`);
  }
  return buffer;
}

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function nodeTagName(node: OrderedNode): string {
  return Object.keys(node).find((key) => key !== ':@') ?? '';
}

function nodeAttrs(node: OrderedNode): Record<string, unknown> {
  return (node[':@'] as Record<string, unknown>) ?? {};
}

function attr(attrs: Record<string, unknown>, name: string): string {
  const value = attrs[name];
  return typeof value === 'string' ? value : '';
}

/**
 * Zip entry names and OPF hrefs can disagree on case even though they address the same resource,
 * and readers resolve them case-insensitively. Matching on a folded key stops a mismatch from
 * silently leaving audio bytes in an archive whose manifest no longer declares them.
 */
function removalKey(path: string): string {
  return normalizeEpubZipPath(path).toLowerCase();
}

function safeEntryName(path: string): string {
  const raw = (path ?? '').replace(/\\/g, '/');
  const normalized = normalizeEpubZipPath(raw);
  if (!normalized) return '';
  return raw.endsWith('/') ? `${normalized}/` : normalized;
}

function isPackageTag(tag: string): boolean {
  return tag === 'package' || tag.endsWith(':package');
}

function isManifestTag(tag: string): boolean {
  return tag === 'manifest' || tag.endsWith(':manifest');
}

function isMetadataTag(tag: string): boolean {
  return tag === 'metadata' || tag.endsWith(':metadata');
}

function isItemTag(tag: string): boolean {
  return tag === 'item' || tag.endsWith(':item');
}

function isMetaTag(tag: string): boolean {
  return tag === 'meta' || tag.endsWith(':meta');
}

function isRootfileTag(tag: string): boolean {
  return tag === 'rootfile' || tag.endsWith(':rootfile');
}

function isAudioMediaType(mediaType: string): boolean {
  return mediaType.toLowerCase().startsWith('audio/');
}

function isSmilMediaType(mediaType: string): boolean {
  return mediaType.toLowerCase() === 'application/smil+xml';
}

function isMediaOverlayMetadata(attrs: Record<string, unknown>): boolean {
  const property = attr(attrs, '@_property').toLowerCase();
  const name = attr(attrs, '@_name').toLowerCase();
  return property.startsWith('media:') || property.startsWith('storyteller:') || name.startsWith('storyteller:');
}

function isOverlayVocabularyPrefix(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized === 'media:' || normalized === 'storyteller:';
}

function isOverlayVocabularyToken(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized.startsWith('media:') || normalized.startsWith('storyteller:');
}

function isStorytellerReadaloudStylesheet(entryPath: string): boolean {
  return /(^|\/)storyteller-readaloud\.css$/i.test(entryPath);
}

function patchStorytellerReadaloudStylesheet(content: string): string {
  if (content.includes('BookOrbit: Storyteller wraps synced sentences')) return content;
  return `${content.replace(/\s*$/, '')}${STORYTELLER_SPAN_RESET}`;
}

function stripOverlayVocabularyMappings(prefix: string): string {
  const tokens = prefix.split(/\s+/).filter(Boolean);
  const cleaned: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (isOverlayVocabularyPrefix(tokens[index])) {
      index += 1;
      continue;
    }
    cleaned.push(tokens[index]);
  }
  return cleaned.join(' ');
}

async function readRootfilePath(zip: unzipper.CentralDirectory, maxMetadataBytes: number): Promise<string> {
  const entry = findEpubZipEntry(zip.files, 'META-INF/container.xml');
  if (!entry) throw new BadRequestException('Invalid EPUB: missing META-INF/container.xml');
  const doc = opfParser.parse(await readBoundedEntry(entry, maxMetadataBytes, 'container.xml')) as OrderedNode[];
  const visit = (nodes: OrderedNode[]): string | null => {
    for (const node of nodes) {
      const tag = nodeTagName(node);
      if (isRootfileTag(tag)) {
        const fullPath = attr(nodeAttrs(node), '@_full-path');
        if (fullPath) return normalizeEpubZipPath(fullPath);
      }
      const found = visit(toArray(node[tag] as OrderedNode | OrderedNode[]));
      if (found) return found;
    }
    return null;
  };
  const rootfilePath = visit(doc);
  if (rootfilePath) return rootfilePath;
  throw new BadRequestException('Invalid EPUB: cannot find OPF path in container.xml');
}

function appendEntryStream(archive: Archiver, entry: { stream: () => Readable }, name: string, reject: (error: Error) => void): void {
  const source = entry.stream();
  source.once('error', reject);
  archive.append(source, { name, date: ZIP_ENTRY_DATE });
}

/**
 * Rebuilds a read-along EPUB without its narration audio, keeping the sentence anchors that
 * KOReader needs to report a fragment-accurate position. Audio is identified by manifest
 * media-type, so an EPUB that also plays audio from its own XHTML (rather than through a media
 * overlay) is left with dangling references; Storyteller output never does this.
 */
@Injectable()
export class AudiolessEpubService {
  private activeBuilds = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(@Inject(audiolessEpubConfig.KEY) private readonly config: ConfigType<typeof audiolessEpubConfig>) {}

  /**
   * Builds the archive and writes it to disk while holding a build slot, so a device syncing a
   * shelf of read-alongs queues instead of running every rebuild at once.
   */
  async writeArchive(epubPath: string, destinationPath: string): Promise<AudiolessEpubResult> {
    await this.acquireBuildSlot();
    try {
      const { archive, ...counts } = await this.createArchive(epubPath);
      const output = createWriteStream(destinationPath);
      await new Promise<void>((resolve, reject) => {
        output.on('close', resolve);
        output.on('error', reject);
        archive.on('error', reject);
        archive.pipe(output);
        // finalize() reports failures through a rejected promise as well as the 'error' event.
        // Routing it back into reject() settles the build when only the promise fires, and keeps
        // an already-rejected build from turning the duplicate into a process-level crash.
        archive.finalize().catch(reject);
      });
      return counts;
    } finally {
      this.releaseBuildSlot();
    }
  }

  async createArchive(epubPath: string): Promise<AudiolessEpubArchive> {
    const zip = await unzipper.Open.file(epubPath);
    if (zip.files.length > this.config.maxSourceEntries) {
      throw new BadRequestException(`Invalid EPUB: archive declares ${zip.files.length} entries, over the ${this.config.maxSourceEntries} limit`);
    }

    const opfPath = await readRootfilePath(zip, this.config.maxMetadataBytes);
    const opfEntry = findEpubZipEntry(zip.files, opfPath);
    if (!opfEntry) throw new BadRequestException(`Invalid EPUB: OPF not found at ${opfPath}`);

    const opfXml = (await readBoundedEntry(opfEntry, this.config.maxMetadataBytes, 'OPF')).toString('utf-8');
    const parsedOpf = opfParser.parse(opfXml) as OrderedNode[];
    const removeEntryPaths = await this.collectMediaOverlayEntryPaths(epubPath, opfPath, parsedOpf);
    this.assertOutputWithinLimit(zip.files, removeEntryPaths);
    const patchedOpf = this.stripMediaOverlayFromOpf(parsedOpf, opfPath, removeEntryPaths);

    const archive = new ZipArchive({ zlib: { level: 6 } });
    let removedEntries = 0;
    let sanitizedEntries = 0;
    archive.append(Buffer.from('application/epub+zip'), { name: 'mimetype', store: true, date: ZIP_ENTRY_DATE });

    for (const entry of zip.files) {
      const entryKey = removalKey(entry.path);
      if (entryKey === 'mimetype') continue;
      if (removeEntryPaths.has(entryKey)) {
        removedEntries += 1;
        continue;
      }

      const entryName = safeEntryName(entry.path);
      if (entryName !== entry.path) sanitizedEntries += 1;
      if (!entryName) continue;

      if (entryKey === removalKey(opfPath)) {
        archive.append(Buffer.from(patchedOpf), { name: entryName, date: ZIP_ENTRY_DATE });
        continue;
      }
      if (isStorytellerReadaloudStylesheet(entryKey)) {
        const css = await readBoundedEntry(entry, this.config.maxMetadataBytes, 'stylesheet');
        archive.append(Buffer.from(patchStorytellerReadaloudStylesheet(css.toString('utf-8'))), { name: entryName, date: ZIP_ENTRY_DATE });
        continue;
      }
      appendEntryStream(archive, entry, entryName, (error) => archive.emit('error', error));
    }

    return { archive, removedEntries, sanitizedEntries };
  }

  private async collectMediaOverlayEntryPaths(epubPath: string, opfPath: string, parsedOpf: OrderedNode[]): Promise<Set<string>> {
    const result = new Set<string>();
    const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    let declaresAudio = false;

    for (const item of this.findManifestItemNodes(parsedOpf)) {
      const attrs = nodeAttrs(item);
      const mediaType = attr(attrs, '@_media-type');
      const href = attr(attrs, '@_href');
      if (!href) continue;
      if (isAudioMediaType(mediaType) || isSmilMediaType(mediaType)) {
        if (isAudioMediaType(mediaType)) declaresAudio = true;
        result.add(removalKey(resolveEpubHref(href, opfDir).split('#')[0]));
      }
    }

    // EPUB 3 requires every resource to appear in the manifest, so the scan above is normally
    // complete. Parsing every SMIL file to rediscover the same audio costs far more than the rest
    // of the rebuild combined, so it is kept only as a fallback for archives that declare none.
    if (declaresAudio) return result;

    try {
      const playlist = await buildEpubMediaOverlayPlaylistFromFile(epubPath, 0, null);
      for (const resource of playlist.resources) result.add(removalKey(resource.href));
      for (const item of playlist.items) result.add(removalKey(item.smilHref));
    } catch {
      // The manifest scan above already removed everything the package document declared.
    }
    return result;
  }

  private assertOutputWithinLimit(files: unzipper.File[], removeEntryPaths: Set<string>): void {
    let retainedBytes = 0;
    for (const file of files) {
      if (removeEntryPaths.has(removalKey(file.path))) continue;
      retainedBytes += file.uncompressedSize;
      if (retainedBytes > this.config.maxOutputBytes) {
        throw new BadRequestException(`Invalid EPUB: text content exceeds the ${this.config.maxOutputBytes} byte rebuild limit`);
      }
    }
  }

  private async acquireBuildSlot(): Promise<void> {
    if (this.activeBuilds < this.config.maxConcurrentBuilds) {
      this.activeBuilds += 1;
      return;
    }
    // The released slot is handed straight to this waiter without the counter dropping, so a
    // build arriving before the waiter resumes cannot claim the same slot twice.
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private releaseBuildSlot(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
      return;
    }
    this.activeBuilds -= 1;
  }

  private stripMediaOverlayFromOpf(parsed: OrderedNode[], opfPath: string, removeEntryPaths: Set<string>): string {
    const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

    for (const packageNode of parsed) {
      const packageTag = nodeTagName(packageNode);
      if (!isPackageTag(packageTag)) continue;
      const packageAttrs = nodeAttrs(packageNode);
      for (const key of Object.keys(packageAttrs)) {
        const normalizedKey = key.toLowerCase();
        if (normalizedKey === '@_xmlns:media' || normalizedKey === '@_xmlns:storyteller') delete packageAttrs[key];
      }
      const prefix = attr(packageAttrs, '@_prefix');
      if (prefix) {
        const cleanedPrefix = stripOverlayVocabularyMappings(prefix);
        if (cleanedPrefix) packageAttrs['@_prefix'] = cleanedPrefix;
        else delete packageAttrs['@_prefix'];
      }
      const packageContent = packageNode[packageTag] as OrderedNode[];

      for (const node of packageContent) {
        const tag = nodeTagName(node);
        if (isMetadataTag(tag)) {
          node[tag] = ((node[tag] as OrderedNode[]) ?? []).filter((child) => {
            if (!isMetaTag(nodeTagName(child))) return true;
            return !isMediaOverlayMetadata(nodeAttrs(child));
          });
          continue;
        }
        if (!isManifestTag(tag)) continue;
        const manifestContent = (node[tag] as OrderedNode[]).filter((child) => {
          if (!isItemTag(nodeTagName(child))) return true;
          const attrs = nodeAttrs(child);
          const href = attr(attrs, '@_href');
          const mediaType = attr(attrs, '@_media-type');
          const resolvedHref = href ? removalKey(resolveEpubHref(href, opfDir).split('#')[0]) : '';
          if (isAudioMediaType(mediaType) || isSmilMediaType(mediaType) || removeEntryPaths.has(resolvedHref)) return false;
          delete attrs['@_media-overlay'];
          const properties = attr(attrs, '@_properties')
            .split(/\s+/)
            .filter((value) => value && !isOverlayVocabularyToken(value));
          if (properties.length > 0) attrs['@_properties'] = properties.join(' ');
          else delete attrs['@_properties'];
          return true;
        });
        node[tag] = manifestContent;
      }
    }

    return String(opfBuilder.build(parsed));
  }

  private findManifestItemNodes(parsed: OrderedNode[]): OrderedNode[] {
    for (const packageNode of parsed) {
      const packageTag = nodeTagName(packageNode);
      if (!isPackageTag(packageTag)) continue;
      for (const node of (packageNode[packageTag] as OrderedNode[]) ?? []) {
        const tag = nodeTagName(node);
        if (isManifestTag(tag)) return ((node[tag] as OrderedNode[]) ?? []).filter((child) => isItemTag(nodeTagName(child)));
      }
    }
    return [];
  }
}
