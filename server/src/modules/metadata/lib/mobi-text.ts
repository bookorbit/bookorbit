import { findIsbnInText, type IsbnHit, markupToScanText, mergeIsbnHits } from './isbn-detect';

// Record 0 (PalmDOC header, then the MOBI header from byte 16):
//   0   : compression (uint16BE) - 1 none, 2 PalmDOC, 17480 HUFF/CDIC
//   8   : text record count (uint16BE)
//   12  : encryption (uint16BE) - 0 none
//   20  : MOBI header length (uint32BE), measured from byte 16
//   28  : text encoding (uint32BE) - 65001 UTF-8, 1252 CP1252
//   242 : extra record data flags (uint16BE), present when the header length is at least 0xE4
const COMPRESSION_NONE = 1;
const COMPRESSION_PALMDOC = 2;
const ENCODING_UTF8 = 65001;
const EXTRA_FLAGS_OFFSET = 0xf2;
const EXTRA_FLAGS_MIN_HEADER_LENGTH = 0xe4;

const TEXT_WINDOW_FRONT = 20;
const TEXT_WINDOW_BACK = 10;
// A text record holds 4096 bytes; the cap only stops a corrupt record from growing without bound.
const MAX_RECORD_TEXT_BYTES = 16 * 1024;

/** Decompress one PalmDOC (LZ77) text record. Stops at the first corrupt back-reference. */
export function decompressPalmDoc(data: Buffer): Buffer {
  const out = Buffer.alloc(MAX_RECORD_TEXT_BYTES);
  let o = 0;
  let i = 0;
  while (i < data.length && o < out.length) {
    const c = data[i++];
    if (c >= 0x01 && c <= 0x08) {
      for (let k = 0; k < c && i < data.length && o < out.length; k++) out[o++] = data[i++];
    } else if (c < 0x80) {
      out[o++] = c;
    } else if (c >= 0xc0) {
      out[o++] = 0x20;
      if (o < out.length) out[o++] = c ^ 0x80;
    } else {
      if (i >= data.length) break;
      const pair = (c << 8) | data[i++];
      const distance = (pair >> 3) & 0x7ff;
      const length = (pair & 0x07) + 3;
      if (distance === 0 || distance > o) break;
      for (let k = 0; k < length && o < out.length; k++, o++) out[o] = out[o - distance];
    }
  }
  return out.subarray(0, o);
}

function backwardVarint(record: Buffer, end: number): number {
  let value = 0;
  let shift = 0;
  for (let pos = end - 1; pos >= 0 && shift < 28; pos--) {
    const byte = record[pos];
    value |= (byte & 0x7f) << shift;
    shift += 7;
    if (byte & 0x80) break;
  }
  return value;
}

/** Bytes of trailing entries (index data, multibyte overlap) appended to a text record after its text. */
function trailingEntriesSize(record: Buffer, flags: number): number {
  let size = 0;
  for (let rest = flags >> 1; rest !== 0; rest >>= 1) {
    if (rest & 1) size += backwardVarint(record, record.length - size);
  }
  if (flags & 1) {
    const at = record.length - size - 1;
    if (at >= 0) size += (record[at] & 0x03) + 1;
  }
  return size;
}

/**
 * The front and back text of a MOBI/AZW3 file as plain text, one passage per window. Null when
 * the text cannot be read here: DRM, HUFF/CDIC compression, or a header that does not add up.
 */
export function readMobiTextWindows(buf: Buffer, recordOffsets: number[]): string[] | null {
  const recordAt = (index: number) => buf.subarray(recordOffsets[index], recordOffsets[index + 1] ?? buf.length);
  const rec0 = recordAt(0);
  if (rec0.length < 32) return null;

  const compression = rec0.readUInt16BE(0);
  if (rec0.readUInt16BE(12) !== 0) return null;
  if (compression !== COMPRESSION_NONE && compression !== COMPRESSION_PALMDOC) return null;

  const textRecordCount = Math.min(rec0.readUInt16BE(8), recordOffsets.length - 1);
  const headerLength = rec0.readUInt32BE(20);
  const extraFlags =
    headerLength >= EXTRA_FLAGS_MIN_HEADER_LENGTH && rec0.length >= EXTRA_FLAGS_OFFSET + 2 ? rec0.readUInt16BE(EXTRA_FLAGS_OFFSET) : 0;
  const decoder = new TextDecoder(rec0.readUInt32BE(28) === ENCODING_UTF8 ? 'utf-8' : 'windows-1252');

  // A run of records is decoded as one buffer so a character or ISBN split across records survives.
  const readRun = (first: number, last: number): string => {
    const chunks: Buffer[] = [];
    for (let index = first; index <= last; index++) {
      const record = recordAt(index);
      const textLength = record.length - trailingEntriesSize(record, extraFlags);
      if (textLength <= 0) continue;
      const raw = record.subarray(0, textLength);
      chunks.push(compression === COMPRESSION_PALMDOC ? decompressPalmDoc(raw) : raw.subarray(0, MAX_RECORD_TEXT_BYTES));
    }
    return markupToScanText(decoder.decode(Buffer.concat(chunks)));
  };

  if (textRecordCount < 1) return [];
  if (textRecordCount <= TEXT_WINDOW_FRONT + TEXT_WINDOW_BACK) return [readRun(1, textRecordCount)];
  return [readRun(1, TEXT_WINDOW_FRONT), readRun(textRecordCount - TEXT_WINDOW_BACK + 1, textRecordCount)];
}

/** Every ISBN printed in the front and back text of a MOBI/AZW3 file, or null when its text cannot be read. */
export function collectMobiIsbnHits(buf: Buffer, recordOffsets: number[]): IsbnHit[] | null {
  const passages = readMobiTextWindows(buf, recordOffsets);
  return passages === null ? null : mergeIsbnHits(passages.map((passage) => findIsbnInText(passage)));
}
