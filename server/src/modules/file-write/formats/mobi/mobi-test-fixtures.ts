// Builds structurally valid PalmDB/MOBI buffers in memory so the writer suite never
// depends on real book files. The layout mirrors what real producers emit:
//
//   record 0            header record (PalmDOC + MOBI header + EXTH + full name + slack)
//   records 1..N        text records
//   cover, thumbnail    image records
//   [KF8 header]        only for dual-format fixtures
//   FLIS, FCIS, EOF     trailing records
//
// EXTH types used by the fixture (100/101/103/104/105/106/121/201/202/503/524) match
// the real format; see mobi-exth.ts.

const PALMDB_HEADER_SIZE = 78;
const RECORD_ENTRY_SIZE = 8;
const RECORD_LIST_GAP = 2;

const DEFAULT_MOBI_HEADER_LENGTH = 232;
const DEFAULT_SLACK = 8192;

export interface FixtureExthRecord {
  type: number;
  data: Buffer | string | number;
}

export interface MobiHeaderFixtureOptions {
  fileVersion?: number;
  encoding?: number;
  mobiHeaderLength?: number;
  encryption?: number;
  fullName?: string;
  exth?: FixtureExthRecord[];
  /** Trailing zero padding inside the header record; real files carry roughly 8KB. */
  slack?: number;
  omitExth?: boolean;
}

export interface MobiFixtureOptions extends MobiHeaderFixtureOptions {
  textRecordCount?: number;
  cover?: Buffer | null;
  thumbnail?: Buffer | null;
  /** Adds a second MOBI header record and points EXTH 121 at it. */
  kf8Header?: MobiHeaderFixtureOptions | null;
  /** Written verbatim into EXTH 121 instead of a real boundary index. */
  kf8BoundaryOverride?: number;
  appInfoId?: number;
  sortInfoId?: number;
}

export function fakeImageRecord(size: number, seed = 0x41): Buffer {
  const buffer = Buffer.alloc(size, seed);
  buffer[0] = 0xff;
  buffer[1] = 0xd8;
  return buffer;
}

function exthPayload(data: Buffer | string | number): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(data, 0);
  return buffer;
}

function buildExth(records: FixtureExthRecord[]): Buffer {
  const body = Buffer.concat(
    records.map(({ type, data }) => {
      const payload = exthPayload(data);
      const record = Buffer.alloc(8 + payload.length);
      record.writeUInt32BE(type, 0);
      record.writeUInt32BE(8 + payload.length, 4);
      payload.copy(record, 8);
      return record;
    }),
  );

  const block = Buffer.alloc(12 + body.length);
  block.write('EXTH', 0, 'ascii');
  block.writeUInt32BE(block.length, 4);
  block.writeUInt32BE(records.length, 8);
  body.copy(block, 12);
  return block;
}

function buildHeaderRecord(options: MobiHeaderFixtureOptions, firstImageIndex: number): Buffer {
  const mobiHeaderLength = options.mobiHeaderLength ?? DEFAULT_MOBI_HEADER_LENGTH;
  const exthRecords = options.exth ?? [];
  const includeExth = !options.omitExth;
  const exthBlock = includeExth ? buildExth(exthRecords) : Buffer.alloc(0);

  const exthStart = 16 + mobiHeaderLength;
  const namePadding = (4 - ((exthStart + exthBlock.length) % 4)) % 4;
  const nameOffset = exthStart + exthBlock.length + namePadding;
  const nameBuffer = Buffer.from(options.fullName ?? 'Fixture Title', 'utf8');

  const size = nameOffset + nameBuffer.length + (options.slack ?? DEFAULT_SLACK);
  const record = Buffer.alloc(size, 0);

  record.writeUInt16BE(2, 0); // PalmDOC compression
  record.writeUInt16BE(options.encryption ?? 0, 12);
  record.write('MOBI', 16, 'ascii');
  record.writeUInt32BE(mobiHeaderLength, 20);
  record.writeUInt32BE(2, 24);
  record.writeUInt32BE(options.encoding ?? 65001, 28);
  record.writeUInt32BE(options.fileVersion ?? 6, 36);
  record.writeUInt32BE(nameOffset, 84);
  record.writeUInt32BE(nameBuffer.length, 88);
  record.writeUInt32BE(firstImageIndex, 108);
  record.writeUInt32BE(includeExth ? 0x40 : 0, 128);

  exthBlock.copy(record, exthStart);
  nameBuffer.copy(record, nameOffset);
  return record;
}

function assemble(records: Buffer[], appInfoId: number, sortInfoId: number): Buffer {
  const headSize = PALMDB_HEADER_SIZE + records.length * RECORD_ENTRY_SIZE + RECORD_LIST_GAP;
  const head = Buffer.alloc(headSize, 0);
  head.write('FixtureBook', 0, 'ascii');
  head.writeUInt32BE(appInfoId, 52);
  head.writeUInt32BE(sortInfoId, 56);
  head.write('BOOK', 60, 'ascii');
  head.write('MOBI', 64, 'ascii');
  head.writeUInt16BE(records.length, 76);

  let cursor = headSize;
  records.forEach((record, index) => {
    head.writeUInt32BE(cursor, PALMDB_HEADER_SIZE + index * RECORD_ENTRY_SIZE);
    head.writeUInt32BE(index * 2, PALMDB_HEADER_SIZE + index * RECORD_ENTRY_SIZE + 4);
    cursor += record.length;
  });

  return Buffer.concat([head, ...records]);
}

export function buildMobiFixture(options: MobiFixtureOptions = {}): Buffer {
  const textRecordCount = options.textRecordCount ?? 3;
  const cover = options.cover === undefined ? fakeImageRecord(2048, 0x11) : options.cover;
  const thumbnail = options.thumbnail === undefined ? fakeImageRecord(512, 0x22) : options.thumbnail;

  const textRecords = Array.from({ length: textRecordCount }, (_, i) => Buffer.alloc(64, 0x50 + i));
  const imageRecords = [cover, thumbnail].filter((record): record is Buffer => record !== null);
  const firstImageIndex = 1 + textRecords.length;

  const exth: FixtureExthRecord[] = [...(options.exth ?? [])];
  if (cover) exth.push({ type: 201, data: 0 });
  if (cover && thumbnail) exth.push({ type: 202, data: 1 });

  const trailing = [Buffer.from('FLIS'), Buffer.from('FCIS'), Buffer.from([0xe9, 0x8e, 0x0d, 0x0a])];

  // The KF8 header sits after the images, and EXTH 121 in the main header points at it.
  const kf8Index = options.kf8Header ? 1 + textRecords.length + imageRecords.length : null;
  const boundaryValue = options.kf8BoundaryOverride ?? kf8Index;
  if (boundaryValue !== null && boundaryValue !== undefined) exth.push({ type: 121, data: boundaryValue });

  const headerRecord = buildHeaderRecord({ ...options, exth }, firstImageIndex);
  const kf8Record = options.kf8Header ? buildHeaderRecord({ fileVersion: 8, ...options.kf8Header }, firstImageIndex) : null;

  const records = [headerRecord, ...textRecords, ...imageRecords, ...(kf8Record ? [kf8Record] : []), ...trailing];
  return assemble(records, options.appInfoId ?? 0, options.sortInfoId ?? 0);
}

export function readRecord(buf: Buffer, index: number): Buffer {
  const count = buf.readUInt16BE(76);
  const offsetAt = (i: number) => buf.readUInt32BE(PALMDB_HEADER_SIZE + i * RECORD_ENTRY_SIZE);
  if (index >= count) throw new Error(`record ${index} out of range`);
  return buf.subarray(offsetAt(index), index + 1 < count ? offsetAt(index + 1) : buf.length);
}

export function recordCount(buf: Buffer): number {
  return buf.readUInt16BE(76);
}

/** Index of the first image record in a default fixture. */
export function fixtureFirstImageIndex(textRecordCount = 3): number {
  return 1 + textRecordCount;
}
