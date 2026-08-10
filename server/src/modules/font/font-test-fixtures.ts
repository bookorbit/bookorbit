import { deflateSync } from 'zlib';

/**
 * Builders for synthetic font binaries, so metadata tests exercise real byte layouts
 * instead of trusting a mock to describe them. Each builder allows deliberately
 * malformed output (declared lengths, offsets and counts that disagree with reality)
 * so parsers can be tested against hostile input.
 */

export const PLATFORM_UNICODE = 0;
export const PLATFORM_MAC = 1;
export const PLATFORM_WINDOWS = 3;

export const LANG_WINDOWS_EN_US = 0x0409;
export const LANG_WINDOWS_EN_GB = 0x0809;
export const LANG_WINDOWS_JAPANESE = 0x0411;
export const LANG_MAC_ENGLISH = 0;

export const NAME_ID_FAMILY = 1;
export const NAME_ID_SUBFAMILY = 2;
export const NAME_ID_TYPOGRAPHIC_FAMILY = 16;
export const NAME_ID_TYPOGRAPHIC_SUBFAMILY = 17;

export interface NameRecord {
  platformID: number;
  languageID: number;
  nameID: number;
  value: string;
  /** Overrides the encoded string, for exercising malformed records. */
  rawValue?: Buffer;
  /** Overrides the storage offset, for pointing a record outside the table. */
  offsetOverride?: number;
}

export interface TableInput {
  tag: string;
  data: Buffer;
  /** Declares a length different from the real one, for malformed-input tests. */
  declaredLength?: number;
  /** Declares an offset different from the real one, for out-of-bounds tests. */
  declaredOffset?: number;
}

export interface WoffTableInput extends TableInput {
  compress?: boolean;
  declaredOrigLength?: number;
}

function encodeNameValue(record: NameRecord): Buffer {
  if (record.rawValue) return record.rawValue;
  if (record.platformID === PLATFORM_WINDOWS || record.platformID === PLATFORM_UNICODE) {
    return Buffer.from(record.value, 'utf16le').swap16();
  }
  return Buffer.from(record.value, 'latin1');
}

export function buildNameTable(records: NameRecord[], countOverride?: number): Buffer {
  const encoded = records.map(encodeNameValue);
  const storageOffset = 6 + records.length * 12;

  const header = Buffer.alloc(6);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(countOverride ?? records.length, 2);
  header.writeUInt16BE(storageOffset, 4);

  const recordBytes = Buffer.alloc(records.length * 12);
  let cursor = 0;
  records.forEach((record, i) => {
    const at = i * 12;
    recordBytes.writeUInt16BE(record.platformID, at);
    recordBytes.writeUInt16BE(record.platformID === PLATFORM_WINDOWS ? 1 : 0, at + 2);
    recordBytes.writeUInt16BE(record.languageID, at + 4);
    recordBytes.writeUInt16BE(record.nameID, at + 6);
    recordBytes.writeUInt16BE(encoded[i]!.length, at + 8);
    recordBytes.writeUInt16BE(record.offsetOverride ?? cursor, at + 10);
    cursor += encoded[i]!.length;
  });

  return Buffer.concat([header, recordBytes, ...encoded]);
}

export function buildOs2Table(options: { usWeightClass?: number; fsSelection?: number; length?: number } = {}): Buffer {
  const table = Buffer.alloc(options.length ?? 96);
  if (options.usWeightClass !== undefined && table.length >= 6) table.writeUInt16BE(options.usWeightClass, 4);
  if (options.fsSelection !== undefined && table.length >= 64) table.writeUInt16BE(options.fsSelection, 62);
  return table;
}

export function buildSfnt(tables: TableInput[], signature: Buffer = Buffer.from([0x00, 0x01, 0x00, 0x00]), numTablesOverride?: number): Buffer {
  const header = Buffer.alloc(12);
  signature.copy(header, 0);
  header.writeUInt16BE(numTablesOverride ?? tables.length, 4);

  const directory = Buffer.alloc(tables.length * 16);
  const body: Buffer[] = [];
  let offset = 12 + tables.length * 16;

  tables.forEach((table, i) => {
    const at = i * 16;
    directory.write(table.tag, at, 4, 'latin1');
    directory.writeUInt32BE(0, at + 4);
    directory.writeUInt32BE(table.declaredOffset ?? offset, at + 8);
    directory.writeUInt32BE(table.declaredLength ?? table.data.length, at + 12);
    body.push(table.data);
    offset += table.data.length;
  });

  return Buffer.concat([header, directory, ...body]);
}

export function buildWoff(tables: WoffTableInput[]): Buffer {
  const header = Buffer.alloc(44);
  header.write('wOFF', 0, 4, 'latin1');
  header.writeUInt32BE(0x00010000, 4);
  header.writeUInt16BE(tables.length, 12);

  const directory = Buffer.alloc(tables.length * 20);
  const body: Buffer[] = [];
  let offset = 44 + tables.length * 20;

  tables.forEach((table, i) => {
    const stored = table.compress ? deflateSync(table.data) : table.data;
    const at = i * 20;
    directory.write(table.tag, at, 4, 'latin1');
    directory.writeUInt32BE(table.declaredOffset ?? offset, at + 4);
    directory.writeUInt32BE(table.declaredLength ?? stored.length, at + 8);
    directory.writeUInt32BE(table.declaredOrigLength ?? table.data.length, at + 12);
    directory.writeUInt32BE(0, at + 16);
    body.push(stored);
    offset += stored.length;
  });

  header.writeUInt32BE(offset, 8);
  return Buffer.concat([header, directory, ...body]);
}

export function windowsName(nameID: number, value: string, languageID = LANG_WINDOWS_EN_US): NameRecord {
  return { platformID: PLATFORM_WINDOWS, languageID, nameID, value };
}

export function macName(nameID: number, value: string): NameRecord {
  return { platformID: PLATFORM_MAC, languageID: LANG_MAC_ENGLISH, nameID, value };
}

/** A minimal, well-formed TrueType font carrying just the metadata tables. */
export function buildFontWithMetadata(options: {
  family?: string;
  subfamily?: string;
  typographicFamily?: string;
  typographicSubfamily?: string;
  usWeightClass?: number;
  fsSelection?: number;
}): Buffer {
  const records: NameRecord[] = [];
  if (options.family !== undefined) records.push(windowsName(NAME_ID_FAMILY, options.family));
  if (options.subfamily !== undefined) records.push(windowsName(NAME_ID_SUBFAMILY, options.subfamily));
  if (options.typographicFamily !== undefined) records.push(windowsName(NAME_ID_TYPOGRAPHIC_FAMILY, options.typographicFamily));
  if (options.typographicSubfamily !== undefined) records.push(windowsName(NAME_ID_TYPOGRAPHIC_SUBFAMILY, options.typographicSubfamily));

  return buildSfnt([
    { tag: 'name', data: buildNameTable(records) },
    { tag: 'OS/2', data: buildOs2Table({ usWeightClass: options.usWeightClass, fsSelection: options.fsSelection }) },
  ]);
}
