import { readFile } from 'fs/promises';
import { XMLParser } from 'fast-xml-parser';
import { inflateRawSync } from 'zlib';

// ── ZIP binary constants ──────────────────────────────────────────────────────

const LFH_SIG = 0x04034b50; // local file header
const EOCD_SIG = 0x06054b50; // end of central directory

export interface ParsedCbzMetadata {
  title: string | null;
  seriesName: string | null;
  seriesIndex: number | null;
  description: string | null;
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  authors: { name: string; sortName: string | null }[];
  tags: string[];
}

// ── ZIP helpers ───────────────────────────────────────────────────────────────

/** Extract a file by name from a ZIP buffer using local file headers (no central directory). */
function extractZipFile(buf: Buffer, targetName: string): Buffer | null {
  let pos = 0;
  while (pos < buf.length - 30) {
    const sigPos = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), pos);
    if (sigPos === -1) break;

    const compression = buf.readUInt16LE(sigPos + 8);
    const compressedSize = buf.readUInt32LE(sigPos + 18);
    const fileNameLen = buf.readUInt16LE(sigPos + 26);
    const extraLen = buf.readUInt16LE(sigPos + 28);

    const dataStart = sigPos + 30 + fileNameLen + extraLen;
    const fileName = buf.subarray(sigPos + 30, sigPos + 30 + fileNameLen).toString('utf-8');

    if (fileName.toLowerCase() === targetName.toLowerCase()) {
      const compressed = buf.subarray(dataStart, dataStart + compressedSize);
      if (compression === 0) return compressed;
      if (compression === 8) return inflateRawSync(compressed);
    }

    pos = dataStart + compressedSize;
    if (compressedSize === 0) pos = sigPos + 4;
  }
  return null;
}

/** Extract the ZIP comment from the End of Central Directory record. */
function readZipComment(buf: Buffer): string | null {
  // Search backwards for EOCD signature (max ZIP comment = 65535 bytes)
  const searchFrom = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= searchFrom; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      const commentLen = buf.readUInt16LE(i + 20);
      if (i + 22 + commentLen === buf.length) {
        return buf.subarray(i + 22, i + 22 + commentLen).toString('utf-8');
      }
    }
  }
  return null;
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

function parseComicInfoXml(xmlBuf: Buffer): ParsedCbzMetadata | null {
  try {
    const parsed = xmlParser.parse(xmlBuf.toString('utf-8')) as Record<string, unknown>;
    const ci = parsed['ComicInfo'] as Record<string, unknown> | undefined;
    if (!ci) return null;

    const str = (key: string) => {
      const v = ci[key];
      return v != null && v !== '' ? String(v).trim() : null;
    };
    const num = (key: string) => {
      const v = parseFloat(str(key) ?? '');
      return isNaN(v) ? null : v;
    };

    // Writers are the "authors" for a book-like view
    const writers = splitDelimited(str('Writer'));
    const year = num('Year');

    const tags = [...splitDelimited(str('Genre')), ...splitDelimited(str('Tags'))];
    const uniqueTags = [...new Set(tags)];

    return {
      title: str('Title'),
      seriesName: str('Series'),
      seriesIndex: num('Number'),
      description: str('Summary') ?? str('Description'),
      publisher: str('Publisher'),
      publishedYear: year != null ? Math.floor(year) : null,
      language: str('LanguageISO'),
      authors: writers.map((name) => ({ name, sortName: null })),
      tags: uniqueTags,
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
      seriesName: (cbi['series'] as string) ?? null,
      seriesIndex: cbi['issue'] != null ? Number(cbi['issue']) || null : null,
      description: (cbi['comments'] as string) ?? null,
      publisher: (cbi['publisher'] as string) ?? null,
      publishedYear: (cbi['publicationYear'] as number) ?? null,
      language: null,
      authors: writers,
      tags,
    };
  } catch {
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

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
