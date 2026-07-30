// PalmDB container layout shared by MOBI, AZW3 and AZW:
//   0  : name (32 bytes)
//   52 : appInfoId (uint32)
//   56 : sortInfoId (uint32)
//   76 : numRecords (uint16)
//   78+: record info list, 8 bytes each - offset(uint32) + attrs/uniqueID(uint32)
//
// MOBI cross-references records by index only (firstImageIndex, EXTH 121/201/202,
// FLIS/FCIS pointers, KF8 kindle:embed URIs), never by byte offset. Resizing a
// record and recomputing this table therefore keeps every reference valid, as long
// as the record count and ordering are preserved.

const NUM_RECORDS_OFFSET = 76;
const RECORD_LIST_OFFSET = 78;
const RECORD_ENTRY_SIZE = 8;
const APP_INFO_ID_OFFSET = 52;
const SORT_INFO_ID_OFFSET = 56;

export function readRecordOffsets(buf: Buffer): number[] {
  if (buf.length < RECORD_LIST_OFFSET) throw new Error('PalmDB header truncated');

  const count = buf.readUInt16BE(NUM_RECORDS_OFFSET);
  if (count === 0) throw new Error('PalmDB contains no records');
  if (buf.length < RECORD_LIST_OFFSET + count * RECORD_ENTRY_SIZE) throw new Error('PalmDB record list truncated');

  const offsets: number[] = [];
  for (let i = 0; i < count; i++) {
    const offset = buf.readUInt32BE(RECORD_LIST_OFFSET + i * RECORD_ENTRY_SIZE);
    if (offset > buf.length) throw new Error(`PalmDB record ${i} offset out of bounds`);
    if (i > 0 && offset < offsets[i - 1]!) throw new Error(`PalmDB record ${i} offset decreases`);
    offsets.push(offset);
  }
  return offsets;
}

export function assertWritablePalmDb(buf: Buffer): void {
  // Both are absolute byte offsets, which the rewrite path would silently invalidate.
  if (buf.readUInt32BE(APP_INFO_ID_OFFSET) !== 0 || buf.readUInt32BE(SORT_INFO_ID_OFFSET) !== 0) {
    throw new Error('PalmDB appInfo/sortInfo area is not supported');
  }
}

export function sliceRecord(buf: Buffer, offsets: number[], index: number): Buffer {
  const start = offsets[index];
  if (start === undefined) throw new Error(`PalmDB record ${index} does not exist`);
  return buf.subarray(start, offsets[index + 1] ?? buf.length);
}

/** Overwrite records without changing their length, leaving the rest of the file byte-identical. */
export function patchRecordsInPlace(buf: Buffer, offsets: number[], replacements: Map<number, Buffer>): Buffer {
  const out = Buffer.from(buf);
  for (const [index, record] of replacements) {
    const original = sliceRecord(buf, offsets, index);
    if (record.length !== original.length) throw new Error(`in-place patch changes record ${index} length`);
    record.copy(out, offsets[index]!);
  }
  return out;
}

/** Rebuild the file with resized records, recomputing the offset table. Indices are preserved. */
export function rebuildWithRecords(buf: Buffer, offsets: number[], replacements: Map<number, Buffer>): Buffer {
  const head = Buffer.from(buf.subarray(0, offsets[0]!));
  const chunks: Buffer[] = [head];

  let cursor = offsets[0]!;
  for (let i = 0; i < offsets.length; i++) {
    const record = replacements.get(i) ?? sliceRecord(buf, offsets, i);
    head.writeUInt32BE(cursor, RECORD_LIST_OFFSET + i * RECORD_ENTRY_SIZE);
    chunks.push(record);
    cursor += record.length;
  }

  return Buffer.concat(chunks);
}
