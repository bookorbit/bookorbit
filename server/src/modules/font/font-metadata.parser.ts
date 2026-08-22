import { brotliDecompressSync, inflateSync } from 'zlib';

/** A variation axis a font exposes, with its range in user coordinates. */
export interface FontVariationAxis {
  tag: string;
  min: number;
  default: number;
  max: number;
}

/** A position on the variation axes that the designer gave a name to. */
export interface FontVariationInstance {
  /** Resolved from the `name` table; null when the record is missing or unreadable. */
  name: string | null;
  coordinates: Record<string, number>;
}

export interface RawFontMetadata {
  familyName: string | null;
  subfamilyName: string | null;
  usWeightClass: number | undefined;
  fsSelection: number | undefined;
  axes: FontVariationAxis[];
  instances: FontVariationInstance[];
}

const SFNT_TABLE_DIRECTORY_OFFSET = 12;
const SFNT_TABLE_ENTRY_SIZE = 16;
const WOFF_TABLE_DIRECTORY_OFFSET = 44;
const WOFF_TABLE_ENTRY_SIZE = 20;
const WOFF2_HEADER_SIZE = 48;

// A font may legitimately carry a few dozen tables. Anything beyond this is malformed
// or crafted, and the count controls how much we read, so bound it before allocating.
const MAX_TABLE_COUNT = 512;

// `name`, `OS/2` and `fvar` are metadata tables measured in kilobytes. A larger declared
// size means the file is malformed or hostile, so refuse to allocate or inflate for it.
const MAX_METADATA_TABLE_BYTES = 4 * 1024 * 1024;

/**
 * WOFF2 stores every table in one Brotli stream, so unlike sfnt and WOFF there is no way
 * to reach `fvar` without expanding the glyphs that precede it. Fonts that would expand
 * past this keep the filename fallback rather than costing hundreds of megabytes for a
 * family name and a weight range; in practice only large CJK faces reach it.
 */
const MAX_WOFF2_DECOMPRESSED_BYTES = 32 * 1024 * 1024;

const TABLES_OF_INTEREST = new Set(['name', 'OS/2', 'fvar']);

// Table tags a WOFF2 directory can reference by index instead of spelling out. Order is
// fixed by the WOFF2 specification; index 63 means an explicit 4-byte tag follows.
// prettier-ignore
const WOFF2_KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post',
  'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea',
  'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar',
  'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop',
  'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];

const WOFF2_ARBITRARY_TAG = 63;
// Only `glyf` and `loca` invert the meaning of the transform version, using 3 for "not
// transformed" where every other table uses 0.
const WOFF2_NULL_TRANSFORM_GLYF_LOCA = 3;

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

const FVAR_HEADER_SIZE = 16;
const FVAR_MIN_AXIS_SIZE = 20;
// A real font carries a handful of axes and at most a few dozen named instances. The
// counts drive how much of the table is walked, so bound them before iterating.
const MAX_VARIATION_AXES = 64;
const MAX_NAMED_INSTANCES = 256;

/**
 * Reads font metadata by locating only the `name`, `OS/2` and `fvar` tables.
 *
 * A full font parse materialises an object per glyph, which for a CJK font of tens of
 * thousands of glyphs costs hundreds of megabytes to obtain a family name and a few
 * integers. Reading the metadata tables directly keeps cost independent of both file
 * size and glyph count, except for WOFF2, whose single compressed stream forces a bounded
 * whole-font expansion.
 *
 * Throws when the container cannot be read at all; callers fall back to filename
 * heuristics. Individual tables that are absent or unreadable yield null/undefined
 * fields rather than throwing, so a font with a damaged `name` table still reports
 * whatever `OS/2` provides.
 */
export function parseFontMetadata(buffer: Buffer): RawFontMetadata {
  const tables = readTables(buffer);

  const names = parseNameTable(tables.get('name') ?? null);
  const variations = parseFvarTable(tables.get('fvar') ?? null, names);

  return {
    familyName: names.get(NAME_ID_TYPOGRAPHIC_FAMILY) ?? names.get(NAME_ID_FAMILY) ?? null,
    subfamilyName: names.get(NAME_ID_TYPOGRAPHIC_SUBFAMILY) ?? names.get(NAME_ID_SUBFAMILY) ?? null,
    ...parseOs2Table(tables.get('OS/2') ?? null),
    ...variations,
  };
}

function readTables(buffer: Buffer): Map<string, Buffer> {
  if (buffer.length < SFNT_TABLE_DIRECTORY_OFFSET) {
    throw new Error('Font is too small to contain a table directory');
  }

  const signature = buffer.toString('latin1', 0, 4);
  const isTrueTypeVersion1 = buffer.readUInt32BE(0) === 0x00010000;

  if (isTrueTypeVersion1 || signature === 'true' || signature === 'typ1' || signature === 'OTTO') {
    return readSfntTables(buffer);
  }
  if (signature === 'wOFF') {
    return readWoffTables(buffer);
  }
  if (signature === 'wOF2') {
    return readWoff2Tables(buffer);
  }
  throw new Error('Unrecognized font signature');
}

function checkTableCount(numTables: number): void {
  if (numTables === 0 || numTables > MAX_TABLE_COUNT) {
    throw new Error('Implausible table count');
  }
}

/** Slices a table out of its container, refusing implausible sizes and short reads. */
function sliceTable(buffer: Buffer, offset: number, length: number): Buffer | null {
  if (length > MAX_METADATA_TABLE_BYTES) return null;
  if (offset + length > buffer.length) return null;
  return buffer.subarray(offset, offset + length);
}

function readSfntTables(buffer: Buffer): Map<string, Buffer> {
  const numTables = buffer.readUInt16BE(4);
  checkTableCount(numTables);
  if (SFNT_TABLE_DIRECTORY_OFFSET + numTables * SFNT_TABLE_ENTRY_SIZE > buffer.length) {
    throw new Error('Table directory extends past end of font');
  }

  const tables = new Map<string, Buffer>();
  for (let i = 0; i < numTables; i += 1) {
    const record = SFNT_TABLE_DIRECTORY_OFFSET + i * SFNT_TABLE_ENTRY_SIZE;
    const tag = buffer.toString('latin1', record, record + 4);
    if (!TABLES_OF_INTEREST.has(tag)) continue;

    const table = sliceTable(buffer, buffer.readUInt32BE(record + 8), buffer.readUInt32BE(record + 12));
    if (table) tables.set(tag, table);
  }
  return tables;
}

function readWoffTables(buffer: Buffer): Map<string, Buffer> {
  if (buffer.length < WOFF_TABLE_DIRECTORY_OFFSET) {
    throw new Error('WOFF header is truncated');
  }

  const numTables = buffer.readUInt16BE(12);
  checkTableCount(numTables);
  if (WOFF_TABLE_DIRECTORY_OFFSET + numTables * WOFF_TABLE_ENTRY_SIZE > buffer.length) {
    throw new Error('Table directory extends past end of font');
  }

  const tables = new Map<string, Buffer>();
  for (let i = 0; i < numTables; i += 1) {
    const record = WOFF_TABLE_DIRECTORY_OFFSET + i * WOFF_TABLE_ENTRY_SIZE;
    const tag = buffer.toString('latin1', record, record + 4);
    if (!TABLES_OF_INTEREST.has(tag)) continue;

    const compLength = buffer.readUInt32BE(record + 8);
    const origLength = buffer.readUInt32BE(record + 12);
    if (origLength > MAX_METADATA_TABLE_BYTES) continue;

    const raw = sliceTable(buffer, buffer.readUInt32BE(record + 4), compLength);
    if (!raw) continue;

    if (compLength === origLength) {
      tables.set(tag, raw);
      continue;
    }
    try {
      tables.set(tag, inflateSync(raw, { maxOutputLength: MAX_METADATA_TABLE_BYTES }));
    } catch {
      // A damaged table is skipped; whatever else the font carries still reports.
    }
  }
  return tables;
}

interface Woff2DirectoryEntry {
  tag: string;
  offset: number;
  length: number;
}

/**
 * Expands a WOFF2 font far enough to read its metadata tables.
 *
 * Every table lives in one Brotli stream whose layout is described by a directory of
 * variable-length records, so the directory has to be walked in full - including the
 * transformed `glyf`/`loca` entries we do not want - just to learn where the tables we
 * do want begin.
 */
function readWoff2Tables(buffer: Buffer): Map<string, Buffer> {
  if (buffer.length < WOFF2_HEADER_SIZE) {
    throw new Error('WOFF2 header is truncated');
  }
  if (buffer.toString('latin1', 4, 8) === 'ttcf') {
    throw new Error('WOFF2 font collections are not supported');
  }

  const numTables = buffer.readUInt16BE(12);
  checkTableCount(numTables);

  const totalSfntSize = buffer.readUInt32BE(16);
  if (totalSfntSize > MAX_WOFF2_DECOMPRESSED_BYTES) {
    throw new Error('WOFF2 font is too large to expand for metadata');
  }
  const totalCompressedSize = buffer.readUInt32BE(20);

  const { entries, end } = readWoff2Directory(buffer, numTables);
  if (!entries.some((entry) => TABLES_OF_INTEREST.has(entry.tag))) return new Map();
  if (end + totalCompressedSize > buffer.length) {
    throw new Error('WOFF2 compressed stream extends past end of font');
  }

  const expanded = brotliDecompressSync(buffer.subarray(end, end + totalCompressedSize), {
    maxOutputLength: MAX_WOFF2_DECOMPRESSED_BYTES,
  });

  const tables = new Map<string, Buffer>();
  for (const entry of entries) {
    if (!TABLES_OF_INTEREST.has(entry.tag)) continue;
    const table = sliceTable(expanded, entry.offset, entry.length);
    if (table) tables.set(entry.tag, table);
  }
  return tables;
}

function readWoff2Directory(buffer: Buffer, numTables: number): { entries: Woff2DirectoryEntry[]; end: number } {
  const entries: Woff2DirectoryEntry[] = [];
  let cursor = WOFF2_HEADER_SIZE;
  let offset = 0;

  for (let i = 0; i < numTables; i += 1) {
    if (cursor >= buffer.length) throw new Error('WOFF2 table directory is truncated');

    const flags = buffer.readUInt8(cursor);
    cursor += 1;

    const tagIndex = flags & 0x3f;
    let tag: string;
    if (tagIndex === WOFF2_ARBITRARY_TAG) {
      if (cursor + 4 > buffer.length) throw new Error('WOFF2 table directory is truncated');
      tag = buffer.toString('latin1', cursor, cursor + 4);
      cursor += 4;
    } else {
      const known = WOFF2_KNOWN_TAGS[tagIndex];
      if (!known) throw new Error('WOFF2 table directory references an unknown tag index');
      tag = known;
    }

    const origLength = readUIntBase128(buffer, cursor);
    cursor = origLength.next;

    const transformVersion = (flags >> 6) & 0x03;
    const isGlyfOrLoca = tag === 'glyf' || tag === 'loca';
    const transformed = isGlyfOrLoca ? transformVersion !== WOFF2_NULL_TRANSFORM_GLYF_LOCA : transformVersion !== 0;

    let length = origLength.value;
    if (transformed) {
      const transformLength = readUIntBase128(buffer, cursor);
      cursor = transformLength.next;
      length = transformLength.value;
    }

    if (offset + length > MAX_WOFF2_DECOMPRESSED_BYTES) {
      throw new Error('WOFF2 tables declare more data than the expansion limit allows');
    }

    entries.push({ tag, offset, length });
    offset += length;
  }

  return { entries, end: cursor };
}

/**
 * Reads WOFF2's variable-length integer: seven bits per byte, most significant first,
 * with the high bit marking continuation. The specification forbids both leading zeroes
 * and values wider than 32 bits, and rejecting them keeps a crafted directory from
 * running the cursor somewhere it should not go.
 */
function readUIntBase128(buffer: Buffer, start: number): { value: number; next: number } {
  let value = 0;
  for (let i = 0; i < 5; i += 1) {
    const at = start + i;
    if (at >= buffer.length) throw new Error('WOFF2 integer is truncated');

    const byte = buffer.readUInt8(at);
    if (i === 0 && byte === 0x80) throw new Error('WOFF2 integer has a leading zero');

    value = value * 128 + (byte & 0x7f);
    if (value > 0xffffffff) throw new Error('WOFF2 integer overflows 32 bits');
    if ((byte & 0x80) === 0) return { value, next: at + 1 };
  }
  throw new Error('WOFF2 integer is too long');
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

/**
 * Indexes the best English string for every name id in the table.
 *
 * Every id is kept rather than only the family and subfamily, because a variable font's
 * named instances point at ids the table alone cannot predict. Typographic names
 * (ids 16/17) group weight and style variants under one family ("Source Han Sans" rather
 * than "Source Han Sans Light"), so callers prefer them where both exist.
 */
function parseNameTable(table: Buffer | null): Map<number, string> {
  const names = new Map<number, string>();
  if (!table || table.length < NAME_TABLE_HEADER_SIZE) return names;

  const count = table.readUInt16BE(2);
  const storageOffset = table.readUInt16BE(4);
  const scores = new Map<number, number>();

  for (let i = 0; i < count; i += 1) {
    const record = NAME_TABLE_HEADER_SIZE + i * NAME_RECORD_SIZE;
    if (record + NAME_RECORD_SIZE > table.length) break;

    const platformID = table.readUInt16BE(record);
    const languageID = table.readUInt16BE(record + 4);
    const nameID = table.readUInt16BE(record + 6);

    const score = englishScore(platformID, languageID);
    if (score === 0) continue;

    const best = scores.get(nameID);
    if (best !== undefined && best >= score) continue;

    const length = table.readUInt16BE(record + 8);
    const offset = table.readUInt16BE(record + 10);
    const start = storageOffset + offset;
    if (start + length > table.length) continue;

    const value = decodeNameValue(table.subarray(start, start + length), platformID)?.trim();
    if (!value) continue;

    names.set(nameID, value);
    scores.set(nameID, score);
  }

  return names;
}

function parseOs2Table(table: Buffer | null): Pick<RawFontMetadata, 'usWeightClass' | 'fsSelection'> {
  if (!table) return { usWeightClass: undefined, fsSelection: undefined };

  return {
    usWeightClass: table.length >= OS2_WEIGHT_CLASS_OFFSET + 2 ? table.readUInt16BE(OS2_WEIGHT_CLASS_OFFSET) : undefined,
    fsSelection: table.length >= OS2_FS_SELECTION_OFFSET + 2 ? table.readUInt16BE(OS2_FS_SELECTION_OFFSET) : undefined,
  };
}

/** Reads a 16.16 fixed-point number, the format every fvar coordinate uses. */
function readFixed(buffer: Buffer, offset: number): number {
  return buffer.readInt32BE(offset) / 65536;
}

/**
 * Reads the variation axes and the instances the designer named along them. A static
 * font has no `fvar` table and yields empty lists.
 */
function parseFvarTable(table: Buffer | null, names: Map<number, string>): Pick<RawFontMetadata, 'axes' | 'instances'> {
  const empty = { axes: [], instances: [] };
  if (!table || table.length < FVAR_HEADER_SIZE) return empty;

  const axesArrayOffset = table.readUInt16BE(4);
  const axisCount = table.readUInt16BE(8);
  const axisSize = table.readUInt16BE(10);
  const instanceCount = table.readUInt16BE(12);
  const instanceSize = table.readUInt16BE(14);

  if (axisCount === 0 || axisCount > MAX_VARIATION_AXES) return empty;
  if (axisSize < FVAR_MIN_AXIS_SIZE) return empty;
  if (axesArrayOffset + axisCount * axisSize > table.length) return empty;

  const axes: FontVariationAxis[] = [];
  for (let i = 0; i < axisCount; i += 1) {
    const at = axesArrayOffset + i * axisSize;
    axes.push({
      tag: table.toString('latin1', at, at + 4),
      min: readFixed(table, at + 4),
      default: readFixed(table, at + 8),
      max: readFixed(table, at + 12),
    });
  }

  return { axes, instances: parseFvarInstances(table, names, axes, axesArrayOffset + axisCount * axisSize, instanceCount, instanceSize) };
}

function parseFvarInstances(
  table: Buffer,
  names: Map<number, string>,
  axes: FontVariationAxis[],
  start: number,
  instanceCount: number,
  instanceSize: number,
): FontVariationInstance[] {
  // Instances carry a coordinate per axis after two identifiers, plus an optional
  // PostScript name id. Anything shorter cannot describe a position on the axes.
  if (instanceSize < 4 + axes.length * 4) return [];

  const instances: FontVariationInstance[] = [];
  const limit = Math.min(instanceCount, MAX_NAMED_INSTANCES);
  for (let i = 0; i < limit; i += 1) {
    const at = start + i * instanceSize;
    if (at + instanceSize > table.length) break;

    const coordinates: Record<string, number> = {};
    axes.forEach((axis, axisIndex) => {
      coordinates[axis.tag] = readFixed(table, at + 4 + axisIndex * 4);
    });

    instances.push({ name: names.get(table.readUInt16BE(at)) ?? null, coordinates });
  }

  return instances;
}
