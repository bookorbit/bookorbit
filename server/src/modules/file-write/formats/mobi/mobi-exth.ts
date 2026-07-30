// EXTH block layout, located at record0[16 + mobiHeaderLength]:
//   0  : "EXTH"
//   4  : length (uint32) covering the 12-byte header plus every record
//   8  : record count (uint32)
//   12+: records - type(uint32) + length(uint32, including the 8-byte header) + payload

export const EXTH_AUTHOR = 100;
export const EXTH_PUBLISHER = 101;
export const EXTH_DESCRIPTION = 103;
export const EXTH_ISBN = 104;
export const EXTH_SUBJECT = 105;
export const EXTH_PUBLISHED_DATE = 106;
export const EXTH_KF8_BOUNDARY = 121;
export const EXTH_COVER_OFFSET = 201;
export const EXTH_THUMB_OFFSET = 202;
export const EXTH_UPDATED_TITLE = 503;
export const EXTH_LANGUAGE = 524;

const EXTH_MAGIC = 'EXTH';
const EXTH_HEADER_SIZE = 12;
const EXTH_RECORD_HEADER_SIZE = 8;

export interface ExthRecord {
  type: number;
  data: Buffer;
}

export function parseExthBlock(rec0: Buffer, exthStart: number): ExthRecord[] | null {
  if (exthStart + EXTH_HEADER_SIZE > rec0.length) return null;
  if (rec0.subarray(exthStart, exthStart + 4).toString('ascii') !== EXTH_MAGIC) return null;

  const count = rec0.readUInt32BE(exthStart + 8);
  const records: ExthRecord[] = [];
  let pos = exthStart + EXTH_HEADER_SIZE;

  for (let i = 0; i < count; i++) {
    if (pos + EXTH_RECORD_HEADER_SIZE > rec0.length) break;
    const type = rec0.readUInt32BE(pos);
    const length = rec0.readUInt32BE(pos + 4);
    if (length < EXTH_RECORD_HEADER_SIZE || pos + length > rec0.length) break;
    records.push({ type, data: Buffer.from(rec0.subarray(pos + EXTH_RECORD_HEADER_SIZE, pos + length)) });
    pos += length;
  }

  return records;
}

export function buildExthBlock(records: ExthRecord[]): Buffer {
  // Calibre emits records sorted by type ascending; matching it keeps diffs stable
  // and makes repeated writes byte-identical.
  const sorted = [...records].sort((a, b) => a.type - b.type);
  const body = Buffer.concat(
    sorted.map(({ type, data }) => {
      const record = Buffer.alloc(EXTH_RECORD_HEADER_SIZE + data.length);
      record.writeUInt32BE(type, 0);
      record.writeUInt32BE(EXTH_RECORD_HEADER_SIZE + data.length, 4);
      data.copy(record, EXTH_RECORD_HEADER_SIZE);
      return record;
    }),
  );

  const block = Buffer.alloc(EXTH_HEADER_SIZE + body.length);
  block.write(EXTH_MAGIC, 0, 'ascii');
  block.writeUInt32BE(block.length, 4);
  block.writeUInt32BE(sorted.length, 8);
  body.copy(block, EXTH_HEADER_SIZE);
  return block;
}

export function readExthUint32(records: readonly ExthRecord[], type: number): number | null {
  const record = records.find((entry) => entry.type === type);
  if (!record || record.data.length < 4) return null;
  return record.data.readUInt32BE(0);
}

/** Drop every managed type so the payload can re-emit them; unmanaged records keep their order. */
export function stripManagedRecords(records: readonly ExthRecord[], managedTypes: ReadonlySet<number>): ExthRecord[] {
  return records.filter((record) => !managedTypes.has(record.type));
}
