import { readFile } from 'fs/promises';
import { XMLParser } from 'fast-xml-parser';
import { inflateRawSync } from 'zlib';
import { createExtractorFromData, UnrarError } from 'node-unrar-js';
import { getSevenZip } from '../../../common/sevenzip';
import { cleanupSevenZipArtifacts, createSevenZipTempId, type SevenZipInstance } from './sevenzip-vfs';

// ── ZIP binary constants ──────────────────────────────────────────────────────

const EOCD_SIG = 0x06054b50; // end of central directory

export interface ParsedCbzComicMetadata {
  issueNumber: string | null;
  volumeName: string | null;
  pencillers: string[];
  inkers: string[];
  colorists: string[];
  letterers: string[];
  coverArtists: string[];
  characters: string[];
  teams: string[];
  locations: string[];
  storyArcs: string[];
}

export interface ParsedCbzMetadata {
  title: string | null;
  subtitle: string | null;
  seriesName: string | null;
  seriesIndex: number | null;
  description: string | null;
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  pageCount: number | null;
  rating: number | null;
  isbn10: string | null;
  isbn13: string | null;
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
  comicMetadata: ParsedCbzComicMetadata | null;
}

// ── ZIP helpers ───────────────────────────────────────────────────────────────

function findEocd(buf: Buffer): { offset: number; cdOffset: number; cdSize: number; comment: string | null } | null {
  const searchFrom = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= searchFrom; i--) {
    if (buf.readUInt32LE(i) !== EOCD_SIG) continue;

    const commentLen = buf.readUInt16LE(i + 20);
    const eocdEnd = i + 22 + commentLen;
    if (eocdEnd !== buf.length) continue;

    const cdSize = buf.readUInt32LE(i + 12);
    const cdOffset = buf.readUInt32LE(i + 16);
    const comment = commentLen > 0 ? buf.subarray(i + 22, eocdEnd).toString('utf-8') : null;

    return { offset: i, cdOffset, cdSize, comment };
  }

  return null;
}

function isZipBoundsValid(start: number, length: number, totalSize: number): boolean {
  return start >= 0 && length >= 0 && start + length <= totalSize;
}

/** Extract a file by name from a ZIP buffer using central directory metadata. */
function extractZipFile(buf: Buffer, targetName: string): Buffer | null {
  const eocd = findEocd(buf);
  if (!eocd) return null;

  const cdStart = eocd.cdOffset;
  const cdEnd = cdStart + eocd.cdSize;
  if (!isZipBoundsValid(cdStart, eocd.cdSize, buf.length)) return null;

  let pos = cdStart;
  while (pos + 46 <= cdEnd) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;

    const compression = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const fileNameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localHeaderOffset = buf.readUInt32LE(pos + 42);

    if (!isZipBoundsValid(pos + 46, fileNameLen, buf.length)) return null;
    const fileName = buf.subarray(pos + 46, pos + 46 + fileNameLen).toString('utf-8');

    if (fileName.toLowerCase() === targetName.toLowerCase()) {
      if (!isZipBoundsValid(localHeaderOffset, 30, buf.length)) return null;
      if (buf.readUInt32LE(localHeaderOffset) !== 0x04034b50) return null;

      const lfhFileNameLen = buf.readUInt16LE(localHeaderOffset + 26);
      const lfhExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + lfhFileNameLen + lfhExtraLen;
      if (!isZipBoundsValid(dataStart, compressedSize, buf.length)) return null;

      const compressed = buf.subarray(dataStart, dataStart + compressedSize);
      if (compression === 0) return compressed;
      if (compression === 8) return inflateRawSync(compressed);
      return null;
    }

    pos += 46 + fileNameLen + extraLen + commentLen;
  }

  return null;
}

/** Extract the ZIP comment from the End of Central Directory record. */
function readZipComment(buf: Buffer): string | null {
  const eocd = findEocd(buf);
  if (!eocd) return null;
  return eocd.comment;
}

// ── Parsers ───────────────────────────────────────────────────────────────────

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

function splitDelimited(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseProjectxManagedNotes(notes: string | null): Map<string, string> {
  const fields = new Map<string, string>();
  if (!notes) return fields;

  for (const line of notes.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^\[bookorbit:([^\]]+)\]\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    fields.set(key, value.trim());
  }

  return fields;
}

function parseProviderIdsFromWebUrl(
  webUrl: string | null,
): Partial<Record<'goodreadsId' | 'amazonId' | 'hardcoverId' | 'googleBooksId' | 'openLibraryId', string>> {
  if (!webUrl) return {};

  if (webUrl.startsWith('https://www.goodreads.com/book/show/')) {
    return { goodreadsId: webUrl.slice('https://www.goodreads.com/book/show/'.length) || '' };
  }
  if (webUrl.startsWith('https://www.amazon.com/dp/')) {
    return { amazonId: webUrl.slice('https://www.amazon.com/dp/'.length) || '' };
  }
  if (webUrl.startsWith('https://hardcover.app/books/')) {
    return { hardcoverId: webUrl.slice('https://hardcover.app/books/'.length) || '' };
  }
  if (webUrl.startsWith('https://books.google.com/books?id=')) {
    return { googleBooksId: webUrl.slice('https://books.google.com/books?id='.length) || '' };
  }
  if (webUrl.startsWith('https://openlibrary.org/works/')) {
    return { openLibraryId: webUrl.slice('https://openlibrary.org/works/'.length) || '' };
  }

  return {};
}

function parseCbxRating(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(10, Math.max(0, parsed * 2));
}

function parseIsbn13(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/[^\d]/g, '');
  return digits.length === 13 ? digits : null;
}

function parseComicInfoXml(xmlBuf: Buffer): ParsedCbzMetadata | null {
  try {
    const parsed = xmlParser.parse(xmlBuf.toString('utf-8')) as Record<string, unknown>;
    const ci = parsed['ComicInfo'] as Record<string, unknown> | undefined;
    if (!ci) return null;

    const str = (key: string): string | null => {
      const v = ci[key];
      if (v == null || v === '') return null;
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      return s.trim() || null;
    };
    const num = (key: string) => {
      const v = parseFloat(str(key) ?? '');
      return isNaN(v) ? null : v;
    };

    const writers = splitDelimited(str('Writer'));
    const year = num('Year');
    const managedNotes = parseProjectxManagedNotes(str('Notes'));
    const providerIdsFromWeb = parseProviderIdsFromWebUrl(str('Web'));

    const genres = splitDelimited(str('Genre'));
    const tags = splitDelimited(str('Tags'));
    const uniqueGenres = [...new Set(genres)];
    const uniqueTags = [...new Set(tags)];

    const pencillers = splitDelimited(str('Penciller'));
    const inkers = splitDelimited(str('Inker'));
    const colorists = splitDelimited(str('Colorist'));
    const letterers = splitDelimited(str('Letterer'));
    const coverArtists = splitDelimited(str('CoverArtist'));
    const characters = splitDelimited(str('Characters'));
    const teams = splitDelimited(str('Teams'));
    const locations = splitDelimited(str('Locations'));
    const storyArcs = splitDelimited(str('StoryArc'));

    const hasComicFields =
      str('Number') !== null ||
      str('Series') !== null ||
      pencillers.length > 0 ||
      inkers.length > 0 ||
      colorists.length > 0 ||
      letterers.length > 0 ||
      coverArtists.length > 0 ||
      characters.length > 0 ||
      teams.length > 0 ||
      locations.length > 0 ||
      storyArcs.length > 0;

    return {
      title: str('Title'),
      subtitle: managedNotes.get('subtitle') ?? null,
      seriesName: str('Series'),
      seriesIndex: num('Number'),
      description: str('Summary') ?? str('Description'),
      publisher: str('Publisher'),
      publishedYear: year != null ? Math.floor(year) : null,
      language: str('LanguageISO'),
      pageCount: num('PageCount'),
      rating: parseCbxRating(str('CommunityRating')),
      isbn10: managedNotes.get('isbn10') ?? null,
      isbn13: parseIsbn13(str('GTIN')),
      authors: writers.map((name) => ({ name, sortName: null })),
      genres: uniqueGenres,
      tags: uniqueTags,
      googleBooksId: managedNotes.get('googleBooksId') ?? providerIdsFromWeb.googleBooksId ?? null,
      goodreadsId: managedNotes.get('goodreadsId') ?? providerIdsFromWeb.goodreadsId ?? null,
      amazonId: managedNotes.get('amazonId') ?? providerIdsFromWeb.amazonId ?? null,
      hardcoverId: managedNotes.get('hardcoverId') ?? providerIdsFromWeb.hardcoverId ?? null,
      openLibraryId: managedNotes.get('openLibraryId') ?? providerIdsFromWeb.openLibraryId ?? null,
      ranobedbId: managedNotes.get('ranobedbId') ?? null,
      itunesId: null,
      comicMetadata: hasComicFields
        ? {
            issueNumber: str('Number'),
            volumeName: str('Volume'),
            pencillers,
            inkers,
            colorists,
            letterers,
            coverArtists,
            characters,
            teams,
            locations,
            storyArcs,
          }
        : null,
    };
  } catch {
    return null;
  }
}

function parseComicBookInfoJson(comment: string): ParsedCbzMetadata | null {
  try {
    const data = JSON.parse(comment) as Record<string, unknown>;
    const cbi = data['ComicBookInfo/1.0'] as Record<string, unknown> | undefined;
    if (!cbi) return null;

    const writers = ((cbi['credits'] as { person: string; role: string }[]) ?? [])
      .filter((c) => c.role === 'Writer')
      .map((c) => ({ name: c.person, sortName: null }));

    const tags = ((cbi['tags'] as string[]) ?? []).filter(Boolean);

    return {
      title: (cbi['title'] as string) ?? null,
      subtitle: null,
      seriesName: (cbi['series'] as string) ?? null,
      seriesIndex: cbi['issue'] != null ? (Number.isFinite(Number(cbi['issue'])) ? Number(cbi['issue']) : null) : null,
      description: (cbi['comments'] as string) ?? null,
      publisher: (cbi['publisher'] as string) ?? null,
      publishedYear: (cbi['publicationYear'] as number) ?? null,
      language: null,
      pageCount: null,
      rating: null,
      isbn10: null,
      isbn13: null,
      authors: writers,
      genres: [],
      tags,
      googleBooksId: null,
      goodreadsId: null,
      amazonId: null,
      hardcoverId: null,
      openLibraryId: null,
      ranobedbId: null,
      itunesId: null,
      comicMetadata: null,
    };
  } catch {
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/**
 * Extract metadata from a CBZ file.
 * Tries ComicInfo.xml first (embedded file), then ComicBookInfo JSON (ZIP comment).
 */
export async function extractCbzMetadata(absolutePath: string): Promise<ParsedCbzMetadata | null> {
  try {
    const buf = await readFile(absolutePath);

    const comicInfoBuf = extractZipFile(buf, 'ComicInfo.xml');
    if (comicInfoBuf) {
      const parsed = parseComicInfoXml(comicInfoBuf);
      if (parsed) return parsed;
    }

    const comment = readZipComment(buf);
    if (comment) {
      const parsed = parseComicBookInfoJson(comment);
      if (parsed) return parsed;
    }

    return null;
  } catch {
    return null;
  }
}

/** Extract ComicInfo.xml metadata from a CBR (RAR) file. */
export async function extractCbrMetadata(absolutePath: string): Promise<ParsedCbzMetadata | null> {
  try {
    const buf = await readFile(absolutePath);
    const ab = toArrayBuffer(buf);

    const extractor = await createExtractorFromData({ data: ab });
    const { files } = extractor.extract({ files: (h) => h.name.toLowerCase() === 'comicinfo.xml' });

    let xmlBuf: Buffer | undefined;
    try {
      for (const file of files) {
        if (!file.fileHeader.flags.directory && file.extraction) xmlBuf = Buffer.from(file.extraction);
      }
    } catch (err) {
      // Some RAR 1.5 archives throw ERAR_BAD_DATA at the end-of-archive marker.
      // If we already extracted the file we needed, use it.
      if (!(err instanceof UnrarError)) throw err;
    }

    return xmlBuf ? parseComicInfoXml(xmlBuf) : null;
  } catch {
    return null;
  }
}

/** Extract ComicInfo.xml metadata from a CB7 (7-Zip) file. */
export async function extractCb7Metadata(absolutePath: string): Promise<ParsedCbzMetadata | null> {
  let sz: SevenZipInstance | null = null;
  let archivePath: string | null = null;
  let outDir: string | null = null;

  try {
    sz = await getSevenZip();
    const buf = await readFile(absolutePath);

    const id = createSevenZipTempId('meta');
    archivePath = `/${id}`;
    outDir = `/${id}_out`;

    const fd = sz.FS.open(archivePath, 'w+');
    sz.FS.write(fd, buf, 0, buf.length);
    sz.FS.close(fd);

    try {
      sz.FS.mkdir(outDir);
    } catch {
      // already exists
    }

    // Extract only ComicInfo.xml — avoids decompressing the whole solid block.
    sz.callMain(['e', archivePath, `-o${outDir}`, 'ComicInfo.xml', '-y']);

    let result: ParsedCbzMetadata | null = null;
    try {
      const xmlData = sz.FS.readFile(`${outDir}/ComicInfo.xml`);
      result = parseComicInfoXml(Buffer.from(xmlData));
    } catch {
      // ComicInfo.xml not present — that's fine
    }

    return result;
  } catch {
    return null;
  } finally {
    if (sz && archivePath && outDir) {
      cleanupSevenZipArtifacts(sz, archivePath, outDir);
    }
  }
}
