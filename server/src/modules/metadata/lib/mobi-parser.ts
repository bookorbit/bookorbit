import { readFile } from 'fs/promises';

import { htmlToPlainText } from '../../../common/utils/html-to-text.utils';

// ── PalmDB / MOBI binary offsets ──────────────────────────────────────────────
//
// PalmDB header (file start):
//   0  : name (32 bytes, null-terminated)
//   76 : numRecords (uint16BE)
//   78 : record list — each entry is 8 bytes: offset(uint32BE) + attrs/id(uint32BE)
//
// Record 0 = MOBI header:
//   0  : PalmDOC header (16 bytes)
//   16 : "MOBI" magic
//   20 : MOBI header length (uint32BE) — measured from byte 16
//   24 : type (uint32BE) — 2 = KF8/AZW3
//   84 : full_name_offset (uint32BE) — offset from start of record 0
//   88 : full_name_length (uint32BE)
//   108: first_image_index (uint32BE) — record index of first image
//   128: exth_flags (uint32BE) — bit 6 (0x40) = EXTH present
//
// EXTH header starts at record0[16 + MOBI_header_length]:
//   0  : "EXTH" magic
//   4  : length (uint32BE)
//   8  : record_count (uint32BE)
//   12+: records — type(4) + length(4) + data(length-8)

// EXTH type IDs
const EXTH = {
  AUTHOR: 100,
  PUBLISHER: 101,
  DESCRIPTION: 103,
  ISBN: 104,
  SUBJECT: 105,
  PUBLISHED_DATE: 106,
  LANGUAGE: 524,
  UPDATED_TITLE: 503,
  COVER_OFFSET: 201,
  THUMB_OFFSET: 202,
} as const;

interface ExthRecord {
  type: number;
  data: Buffer;
}

interface MobiParsed {
  title: string | null;
  authors: string[];
  publisher: string | null;
  description: string | null;
  isbn: string | null;
  tags: string[];
  publishedDate: string | null;
  language: string | null;
  /** Record index of the cover image, or null if not found. */
  coverRecordIndex: number | null;
  /** Record offsets (from start of file) for all records. */
  recordOffsets: number[];
}

function readRecords(buf: Buffer): number[] {
  const numRecords = buf.readUInt16BE(76);
  const offsets: number[] = [];
  for (let i = 0; i < numRecords; i++) {
    offsets.push(buf.readUInt32BE(78 + i * 8));
  }
  return offsets;
}

function parseExth(rec0: Buffer, mobiHeaderLength: number): ExthRecord[] {
  const exthStart = 16 + mobiHeaderLength;
  if (exthStart + 12 > rec0.length) return [];
  if (rec0.slice(exthStart, exthStart + 4).toString('ascii') !== 'EXTH') return [];

  const recordCount = rec0.readUInt32BE(exthStart + 8);
  const records: ExthRecord[] = [];
  let pos = exthStart + 12;

  for (let i = 0; i < recordCount; i++) {
    if (pos + 8 > rec0.length) break;
    const type = rec0.readUInt32BE(pos);
    const length = rec0.readUInt32BE(pos + 4);
    if (length < 8 || pos + length > rec0.length) break;
    records.push({ type, data: rec0.slice(pos + 8, pos + length) });
    pos += length;
  }

  return records;
}

function exthString(records: ExthRecord[], type: number): string | null {
  const rec = records.find((r) => r.type === type);
  return rec ? rec.data.toString('utf8').replace(/\0+$/, '').trim() || null : null;
}

function exthStrings(records: ExthRecord[], type: number): string[] {
  const raw = records
    .filter((r) => r.type === type)
    .map((r) => r.data.toString('utf8').replace(/\0+$/, '').trim())
    .filter(Boolean);

  // Some tools write all values as a single semicolon-separated string; split them.
  return raw.flatMap((v) => v.split(/\s*;\s*/).filter(Boolean));
}

function exthUint32(records: ExthRecord[], type: number): number | null {
  const rec = records.find((r) => r.type === type);
  if (!rec || rec.data.length < 4) return null;
  return rec.data.readUInt32BE(0);
}

export function parseMobiBuffer(buf: Buffer): MobiParsed {
  const recordOffsets = readRecords(buf);
  if (recordOffsets.length === 0) throw new Error('No records in PalmDB');

  const rec0Start = recordOffsets[0];
  const rec0End = recordOffsets[1] ?? buf.length;
  const rec0 = buf.slice(rec0Start, rec0End);

  if (rec0.length < 20 || rec0.slice(16, 20).toString('ascii') !== 'MOBI') {
    throw new Error('MOBI magic not found');
  }

  const mobiHeaderLength = rec0.readUInt32BE(20);
  const exthFlags = rec0.readUInt32BE(128);
  const firstImageIndex = rec0.readUInt32BE(108);

  // Full name (title) from MOBI header
  const fullNameOffset = rec0.readUInt32BE(84);
  const fullNameLength = rec0.readUInt32BE(88);
  const palmTitle =
    fullNameLength > 0 && fullNameOffset + fullNameLength <= rec0.length
      ? rec0
          .slice(fullNameOffset, fullNameOffset + fullNameLength)
          .toString('utf8')
          .trim()
      : null;

  const hasExth = (exthFlags & 0x40) !== 0;
  const exthRecords = hasExth ? parseExth(rec0, mobiHeaderLength) : [];

  const title = exthString(exthRecords, EXTH.UPDATED_TITLE) ?? palmTitle;
  const authors = exthStrings(exthRecords, EXTH.AUTHOR);
  const publisher = exthString(exthRecords, EXTH.PUBLISHER);
  const rawDescription = exthString(exthRecords, EXTH.DESCRIPTION);
  const description = rawDescription ? htmlToPlainText(rawDescription) : null;
  const isbn = exthString(exthRecords, EXTH.ISBN);
  const tags = exthStrings(exthRecords, EXTH.SUBJECT);
  const publishedDate = exthString(exthRecords, EXTH.PUBLISHED_DATE);
  const language = exthString(exthRecords, EXTH.LANGUAGE);

  const coverOffset = exthUint32(exthRecords, EXTH.COVER_OFFSET);
  const coverRecordIndex = coverOffset != null && coverOffset !== 0xffffffff ? firstImageIndex + coverOffset : null;

  return {
    title,
    authors,
    publisher,
    description,
    isbn,
    tags,
    publishedDate,
    language,
    coverRecordIndex,
    recordOffsets,
  };
}

export async function parseMobiFile(absolutePath: string): Promise<MobiParsed | null> {
  try {
    const buf = await readFile(absolutePath);
    return parseMobiBuffer(buf);
  } catch {
    return null;
  }
}

/** Extract raw cover image bytes from a MOBI/AZW3 file. Returns null if not found. */
export async function extractMobiCover(absolutePath: string): Promise<Buffer | null> {
  try {
    const buf = await readFile(absolutePath);
    const parsed = parseMobiBuffer(buf);
    if (parsed.coverRecordIndex === null) return null;

    const idx = parsed.coverRecordIndex;
    if (idx >= parsed.recordOffsets.length) return null;

    const start = parsed.recordOffsets[idx];
    const end = parsed.recordOffsets[idx + 1] ?? buf.length;
    const imageData = buf.slice(start, end);

    // Validate magic bytes: JPEG (FFD8) or PNG (89504E47)
    const isJpeg = imageData[0] === 0xff && imageData[1] === 0xd8;
    const isPng = imageData[0] === 0x89 && imageData[1] === 0x50 && imageData[2] === 0x4e && imageData[3] === 0x47;

    if (!isJpeg && !isPng) return null;
    return imageData;
  } catch {
    return null;
  }
}
