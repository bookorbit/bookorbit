// Record 0 (and the KF8 boundary record in dual-format files) layout:
//   0  : PalmDOC header; byte 12 = encryption type, non-zero means DRM
//   16 : "MOBI"
//   20 : MOBI header length, measured from byte 16
//   28 : text encoding
//   36 : file version (6 = MOBI6, 8 = KF8)
//   84 : full name offset, from the start of the record
//   88 : full name length
//   108: first image record index
//   128: EXTH flags, bit 0x40 = EXTH present
// The EXTH block starts at 16 + headerLength, followed by padding, the full name,
// and then trailing slack (typically ~8KB) that lets metadata grow in place.

import { buildExthBlock, parseExthBlock, type ExthRecord } from './mobi-exth';

const ENCRYPTION_OFFSET = 12;
const MAGIC_OFFSET = 16;
const HEADER_LENGTH_OFFSET = 20;
const ENCODING_OFFSET = 28;
const FILE_VERSION_OFFSET = 36;
const FULL_NAME_OFFSET = 84;
const FULL_NAME_LENGTH_OFFSET = 88;
const FIRST_IMAGE_INDEX_OFFSET = 108;
const EXTH_FLAGS_OFFSET = 128;

const EXTH_PRESENT_FLAG = 0x40;
const MIN_HEADER_RECORD_SIZE = 132;
const FULL_NAME_ALIGNMENT = 4;

export const MOBI_FILE_VERSION_KF8 = 8;

export interface MobiHeaderRecord {
  mobiHeaderLength: number;
  encoding: number;
  fileVersion: number;
  firstImageIndex: number;
  exthStart: number;
  exthRecords: ExthRecord[];
  fullName: Buffer;
}

export function isMobiHeaderRecord(record: Buffer): boolean {
  return record.length >= MIN_HEADER_RECORD_SIZE && record.subarray(MAGIC_OFFSET, MAGIC_OFFSET + 4).toString('ascii') === 'MOBI';
}

export function assertWritableHeaderRecord(record: Buffer): void {
  if (!isMobiHeaderRecord(record)) throw new Error('MOBI header record not found');
  if (record.readUInt16BE(ENCRYPTION_OFFSET) !== 0) throw new Error('MOBI file is DRM encrypted');
}

export function readMobiHeaderRecord(record: Buffer): MobiHeaderRecord {
  assertWritableHeaderRecord(record);

  const mobiHeaderLength = record.readUInt32BE(HEADER_LENGTH_OFFSET);
  const exthStart = MAGIC_OFFSET + mobiHeaderLength;
  const hasExth = (record.readUInt32BE(EXTH_FLAGS_OFFSET) & EXTH_PRESENT_FLAG) !== 0;

  const nameOffset = record.readUInt32BE(FULL_NAME_OFFSET);
  const nameLength = record.readUInt32BE(FULL_NAME_LENGTH_OFFSET);
  const fullName =
    nameLength > 0 && nameOffset + nameLength <= record.length ? Buffer.from(record.subarray(nameOffset, nameOffset + nameLength)) : Buffer.alloc(0);

  return {
    mobiHeaderLength,
    encoding: record.readUInt32BE(ENCODING_OFFSET),
    fileVersion: record.readUInt32BE(FILE_VERSION_OFFSET),
    firstImageIndex: record.readUInt32BE(FIRST_IMAGE_INDEX_OFFSET),
    exthStart,
    exthRecords: (hasExth ? parseExthBlock(record, exthStart) : null) ?? [],
    fullName,
  };
}

export interface RebuiltHeaderRecord {
  record: Buffer;
  fitsOriginalSize: boolean;
}

export function rebuildHeaderRecord(original: Buffer, exthRecords: ExthRecord[], fullName: Buffer): RebuiltHeaderRecord {
  const { exthStart } = readMobiHeaderRecord(original);
  const exthBlock = buildExthBlock(exthRecords);

  const namePadding = (FULL_NAME_ALIGNMENT - ((exthStart + exthBlock.length) % FULL_NAME_ALIGNMENT)) % FULL_NAME_ALIGNMENT;
  const nameOffset = exthStart + exthBlock.length + namePadding;
  const contentEnd = nameOffset + fullName.length;

  const head = Buffer.from(original.subarray(0, exthStart));
  head.writeUInt32BE(nameOffset, FULL_NAME_OFFSET);
  head.writeUInt32BE(fullName.length, FULL_NAME_LENGTH_OFFSET);
  head.writeUInt32BE(head.readUInt32BE(EXTH_FLAGS_OFFSET) | EXTH_PRESENT_FLAG, EXTH_FLAGS_OFFSET);

  // Padding the record back to its original length keeps every PalmDB offset valid,
  // so the rest of the file can stay byte-identical.
  const fitsOriginalSize = contentEnd <= original.length;
  const size = fitsOriginalSize ? original.length : contentEnd + ((FULL_NAME_ALIGNMENT - (contentEnd % FULL_NAME_ALIGNMENT)) % FULL_NAME_ALIGNMENT);

  const record = Buffer.alloc(size, 0);
  head.copy(record, 0);
  exthBlock.copy(record, exthStart);
  fullName.copy(record, nameOffset);

  return { record, fitsOriginalSize };
}
