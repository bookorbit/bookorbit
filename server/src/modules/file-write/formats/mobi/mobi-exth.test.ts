import {
  buildExthBlock,
  EXTH_AUTHOR,
  EXTH_COVER_OFFSET,
  EXTH_LANGUAGE,
  EXTH_PUBLISHER,
  EXTH_UPDATED_TITLE,
  parseExthBlock,
  readExthUint32,
  stripManagedRecords,
  type ExthRecord,
} from './mobi-exth';

function stringRecord(type: number, value: string): ExthRecord {
  return { type, data: Buffer.from(value, 'utf8') };
}

function uint32Record(type: number, value: number): ExthRecord {
  const data = Buffer.alloc(4);
  data.writeUInt32BE(value, 0);
  return { type, data };
}

describe('buildExthBlock', () => {
  it('writes the magic, total length, and record count', () => {
    const block = buildExthBlock([stringRecord(EXTH_AUTHOR, 'Ada Lovelace')]);

    expect(block.subarray(0, 4).toString('ascii')).toBe('EXTH');
    expect(block.readUInt32BE(4)).toBe(block.length);
    expect(block.readUInt32BE(8)).toBe(1);
  });

  it('declares a length that matches the bytes actually emitted', () => {
    const block = buildExthBlock([stringRecord(EXTH_AUTHOR, 'A'), stringRecord(EXTH_PUBLISHER, 'Press'), uint32Record(EXTH_COVER_OFFSET, 0)]);

    expect(block.readUInt32BE(4)).toBe(block.length);
  });

  it('records their own length including the 8-byte record header', () => {
    const block = buildExthBlock([stringRecord(EXTH_AUTHOR, 'Ada')]);

    expect(block.readUInt32BE(12)).toBe(EXTH_AUTHOR);
    expect(block.readUInt32BE(16)).toBe(8 + 3);
  });

  it('sorts records by type ascending so repeated writes stay byte-identical', () => {
    const block = buildExthBlock([stringRecord(EXTH_LANGUAGE, 'en'), stringRecord(EXTH_AUTHOR, 'Ada'), stringRecord(EXTH_PUBLISHER, 'Press')]);

    const parsed = parseExthBlock(block, 0)!;
    expect(parsed.map((record) => record.type)).toEqual([EXTH_AUTHOR, EXTH_PUBLISHER, EXTH_LANGUAGE]);
  });

  it('produces an empty but valid block for no records', () => {
    const block = buildExthBlock([]);

    expect(block).toHaveLength(12);
    expect(parseExthBlock(block, 0)).toEqual([]);
  });
});

describe('parseExthBlock', () => {
  it('round-trips what buildExthBlock produced', () => {
    const records = [stringRecord(EXTH_AUTHOR, 'Ada'), stringRecord(EXTH_AUTHOR, 'Grace'), uint32Record(EXTH_COVER_OFFSET, 7)];
    const parsed = parseExthBlock(buildExthBlock(records), 0)!;

    expect(parsed).toHaveLength(3);
    expect(parsed.filter((record) => record.type === EXTH_AUTHOR).map((record) => record.data.toString('utf8'))).toEqual(['Ada', 'Grace']);
    expect(parsed.find((record) => record.type === EXTH_COVER_OFFSET)!.data.readUInt32BE(0)).toBe(7);
  });

  it('returns null when the magic is missing', () => {
    expect(parseExthBlock(Buffer.alloc(64), 0)).toBeNull();
  });

  it('returns null when the block starts beyond the record', () => {
    expect(parseExthBlock(buildExthBlock([]), 900)).toBeNull();
  });

  it('stops early instead of overrunning a truncated block', () => {
    const block = buildExthBlock([stringRecord(EXTH_AUTHOR, 'Ada'), stringRecord(EXTH_PUBLISHER, 'Press')]);
    const truncated = block.subarray(0, block.length - 6);

    expect(parseExthBlock(truncated, 0)).toHaveLength(1);
  });

  it('stops on a record claiming an impossible length', () => {
    const block = buildExthBlock([stringRecord(EXTH_AUTHOR, 'Ada')]);
    block.writeUInt32BE(4, 16);

    expect(parseExthBlock(block, 0)).toEqual([]);
  });

  it('copies payloads so later mutation of the source does not leak through', () => {
    const block = buildExthBlock([stringRecord(EXTH_AUTHOR, 'Ada')]);
    const parsed = parseExthBlock(block, 0)!;
    block.fill(0, 20);

    expect(parsed[0]!.data.toString('utf8')).toBe('Ada');
  });
});

describe('readExthUint32', () => {
  it('reads a 4-byte payload', () => {
    expect(readExthUint32([uint32Record(EXTH_COVER_OFFSET, 42)], EXTH_COVER_OFFSET)).toBe(42);
  });

  it('returns null when the type is absent', () => {
    expect(readExthUint32([], EXTH_COVER_OFFSET)).toBeNull();
  });

  it('returns null when the payload is too short to be a uint32', () => {
    expect(readExthUint32([{ type: EXTH_COVER_OFFSET, data: Buffer.alloc(2) }], EXTH_COVER_OFFSET)).toBeNull();
  });
});

describe('stripManagedRecords', () => {
  it('removes managed types and keeps the rest in their original order', () => {
    const records = [
      stringRecord(113, 'uuid'),
      stringRecord(EXTH_AUTHOR, 'Ada'),
      stringRecord(501, 'EBOK'),
      stringRecord(EXTH_UPDATED_TITLE, 'Old Title'),
      uint32Record(EXTH_COVER_OFFSET, 0),
    ];

    const kept = stripManagedRecords(records, new Set([EXTH_AUTHOR, EXTH_UPDATED_TITLE]));

    expect(kept.map((record) => record.type)).toEqual([113, 501, EXTH_COVER_OFFSET]);
  });

  it('removes every occurrence of a repeatable managed type', () => {
    const records = [stringRecord(EXTH_AUTHOR, 'Ada'), stringRecord(EXTH_AUTHOR, 'Grace'), stringRecord(113, 'uuid')];

    expect(stripManagedRecords(records, new Set([EXTH_AUTHOR]))).toHaveLength(1);
  });
});
