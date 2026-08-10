import { inflateSync } from 'zlib';

export interface RawFontMetadata {
  familyName: string | null;
  subfamilyName: string | null;
  usWeightClass: number | undefined;
  fsSelection: number | undefined;
}

const SFNT_TABLE_DIRECTORY_OFFSET = 12;
const SFNT_TABLE_ENTRY_SIZE = 16;
const WOFF_TABLE_DIRECTORY_OFFSET = 44;
const WOFF_TABLE_ENTRY_SIZE = 20;

// A font may legitimately carry a few dozen tables. Anything beyond this is malformed
// or crafted, and the count controls how much we read, so bound it before allocating.
const MAX_TABLE_COUNT = 512;

// `name` and `OS/2` are metadata tables measured in kilobytes. A larger declared size
// means the file is malformed or hostile, so refuse to allocate or inflate for it.
const MAX_METADATA_TABLE_BYTES = 4 * 1024 * 1024;

const NAME_ID_FAMILY = 1;
const NAME_ID_SUBFAMILY = 2;
const NAME_ID_TYPOGRAPHIC_FAMILY = 16;
const NAME_ID_TYPOGRAPHIC_SUBFAMILY = 17;

const PLATFORM_UNICODE = 0;
const PLATFORM_MACINTOSH = 1;
const PLATFORM_WINDOWS = 3;

const MAC_LANGUAGE_ENGLISH = 0;
const WINDOWS_PRIMARY_LANGUAGE_ENGLISH = 0x09;
const WINDOWS_PRIMARY_LANGUAGE_MASK = 0x3ff;

const OS2_WEIGHT_CLASS_OFFSET = 4;
const OS2_FS_SELECTION_OFFSET = 62;

const NAME_RECORD_SIZE = 12;
const NAME_TABLE_HEADER_SIZE = 6;

interface TableEntry {
  offset: number;
  compLength: number;
  origLength: number;
}

interface TableDirectory {
  entries: Map<string, TableEntry>;
  isWoff: boolean;
}

/**
 * Reads font metadata by locating only the `name` and `OS/2` tables.
 *
 * A full font parse materialises an object per glyph, which for a CJK font of tens of
 * thousands of glyphs costs hundreds of megabytes to obtain a family name and two
 * integers. Reading the two metadata tables directly keeps cost independent of both
 * file size and glyph count.
 *
 * Throws when the container cannot be read at all; callers fall back to filename
 * heuristics. Individual tables that are absent or unreadable yield null/undefined
 * fields rather than throwing, so a font with a damaged `name` table still reports
 * whatever `OS/2` provides.
 */
export function parseFontMetadata(buffer: Buffer): RawFontMetadata {
  const { entries, isWoff } = readTableDirectory(buffer);

  const nameTable = readTable(buffer, entries.get('name'), isWoff);
  const os2Table = readTable(buffer, entries.get('OS/2'), isWoff);

  return { ...parseNameTable(nameTable), ...parseOs2Table(os2Table) };
}

function readTableDirectory(buffer: Buffer): TableDirectory {
  if (buffer.length < SFNT_TABLE_DIRECTORY_OFFSET) {
    throw new Error('Font is too small to contain a table directory');
  }

  const signature = buffer.toString('latin1', 0, 4);
  const isTrueTypeVersion1 = buffer.readUInt32BE(0) === 0x00010000;

  let numTables: number;
  let directoryOffset: number;
  let entrySize: number;
  let isWoff: boolean;

  if (isTrueTypeVersion1 || signature === 'true' || signature === 'typ1' || signature === 'OTTO') {
    numTables = buffer.readUInt16BE(4);
    directoryOffset = SFNT_TABLE_DIRECTORY_OFFSET;
    entrySize = SFNT_TABLE_ENTRY_SIZE;
    isWoff = false;
  } else if (signature === 'wOFF') {
    if (buffer.length < WOFF_TABLE_DIRECTORY_OFFSET) {
      throw new Error('WOFF header is truncated');
    }
    numTables = buffer.readUInt16BE(12);
    directoryOffset = WOFF_TABLE_DIRECTORY_OFFSET;
    entrySize = WOFF_TABLE_ENTRY_SIZE;
    isWoff = true;
  } else if (signature === 'wOF2') {
    throw new Error('WOFF2 metadata extraction is not supported');
  } else {
    throw new Error('Unrecognized font signature');
  }

  if (numTables === 0 || numTables > MAX_TABLE_COUNT) {
    throw new Error('Implausible table count');
  }
  if (directoryOffset + numTables * entrySize > buffer.length) {
    throw new Error('Table directory extends past end of font');
  }

  const entries = new Map<string, TableEntry>();
  for (let i = 0; i < numTables; i += 1) {
    const record = directoryOffset + i * entrySize;
    const tag = buffer.toString('latin1', record, record + 4);
    if (tag !== 'name' && tag !== 'OS/2') continue;

    entries.set(
      tag,
      isWoff
        ? {
            offset: buffer.readUInt32BE(record + 4),
            compLength: buffer.readUInt32BE(record + 8),
            origLength: buffer.readUInt32BE(record + 12),
          }
        : {
            offset: buffer.readUInt32BE(record + 8),
            compLength: buffer.readUInt32BE(record + 12),
            origLength: buffer.readUInt32BE(record + 12),
          },
    );
  }

  return { entries, isWoff };
}

function readTable(buffer: Buffer, entry: TableEntry | undefined, isWoff: boolean): Buffer | null {
  if (!entry) return null;
  if (entry.compLength > MAX_METADATA_TABLE_BYTES || entry.origLength > MAX_METADATA_TABLE_BYTES) return null;
  if (entry.offset + entry.compLength > buffer.length) return null;

  const raw = buffer.subarray(entry.offset, entry.offset + entry.compLength);
  if (!isWoff || entry.compLength === entry.origLength) return raw;

  try {
    return inflateSync(raw, { maxOutputLength: MAX_METADATA_TABLE_BYTES });
  } catch {
    return null;
  }
}

/**
 * Ranks a name record by how well it answers "what would an English-speaking user call
 * this font?". Zero means the record is for another language and must be ignored.
 */
function englishScore(platformID: number, languageID: number): number {
  if (platformID === PLATFORM_WINDOWS && (languageID & WINDOWS_PRIMARY_LANGUAGE_MASK) === WINDOWS_PRIMARY_LANGUAGE_ENGLISH) return 3;
  if (platformID === PLATFORM_MACINTOSH && languageID === MAC_LANGUAGE_ENGLISH) return 2;
  if (platformID === PLATFORM_UNICODE) return 1;
  return 0;
}

function decodeNameValue(raw: Buffer, platformID: number): string | null {
  if (platformID === PLATFORM_WINDOWS || platformID === PLATFORM_UNICODE) {
    if (raw.length % 2 !== 0) return null;
    // swap16 mutates in place, so copy rather than corrupting the caller's buffer.
    return Buffer.from(raw).swap16().toString('utf16le');
  }
  return raw.toString('latin1');
}

interface NameCandidate {
  value: string;
  score: number;
}

function parseNameTable(table: Buffer | null): Pick<RawFontMetadata, 'familyName' | 'subfamilyName'> {
  if (!table || table.length < NAME_TABLE_HEADER_SIZE) {
    return { familyName: null, subfamilyName: null };
  }

  const count = table.readUInt16BE(2);
  const storageOffset = table.readUInt16BE(4);

  let family: NameCandidate | null = null;
  let subfamily: NameCandidate | null = null;

  for (let i = 0; i < count; i += 1) {
    const record = NAME_TABLE_HEADER_SIZE + i * NAME_RECORD_SIZE;
    if (record + NAME_RECORD_SIZE > table.length) break;

    const platformID = table.readUInt16BE(record);
    const languageID = table.readUInt16BE(record + 4);
    const nameID = table.readUInt16BE(record + 6);

    // Typographic names group weight/style variants under one family ("Source Han Sans"
    // rather than "Source Han Sans Light"), which is what the reader needs to let the
    // browser pick variants, so prefer them over the legacy names when both exist.
    const isFamily = nameID === NAME_ID_FAMILY || nameID === NAME_ID_TYPOGRAPHIC_FAMILY;
    const isSubfamily = nameID === NAME_ID_SUBFAMILY || nameID === NAME_ID_TYPOGRAPHIC_SUBFAMILY;
    if (!isFamily && !isSubfamily) continue;

    const language = englishScore(platformID, languageID);
    if (language === 0) continue;

    const isTypographic = nameID === NAME_ID_TYPOGRAPHIC_FAMILY || nameID === NAME_ID_TYPOGRAPHIC_SUBFAMILY;
    const score = (isTypographic ? 10 : 0) + language;

    const current = isFamily ? family : subfamily;
    if (current && current.score >= score) continue;

    const length = table.readUInt16BE(record + 8);
    const offset = table.readUInt16BE(record + 10);
    const start = storageOffset + offset;
    if (start + length > table.length) continue;

    const value = decodeNameValue(table.subarray(start, start + length), platformID)?.trim();
    if (!value) continue;

    if (isFamily) family = { value, score };
    else subfamily = { value, score };
  }

  return { familyName: family?.value ?? null, subfamilyName: subfamily?.value ?? null };
}

function parseOs2Table(table: Buffer | null): Pick<RawFontMetadata, 'usWeightClass' | 'fsSelection'> {
  if (!table) return { usWeightClass: undefined, fsSelection: undefined };

  return {
    usWeightClass: table.length >= OS2_WEIGHT_CLASS_OFFSET + 2 ? table.readUInt16BE(OS2_WEIGHT_CLASS_OFFSET) : undefined,
    fsSelection: table.length >= OS2_FS_SELECTION_OFFSET + 2 ? table.readUInt16BE(OS2_FS_SELECTION_OFFSET) : undefined,
  };
}
