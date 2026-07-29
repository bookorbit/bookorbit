import { buildExthBlock, EXTH_AUTHOR, EXTH_LANGUAGE, EXTH_UPDATED_TITLE, parseExthBlock, type ExthRecord } from './mobi-exth';
import { assertWritableHeaderRecord, isMobiHeaderRecord, readMobiHeaderRecord, rebuildHeaderRecord } from './mobi-header-record';
import { buildMobiFixture, readRecord } from './mobi-test-fixtures';
import { MOBI_ENCODING_CP1252 } from './mobi-text-encoding';

function headerRecordOf(options: Parameters<typeof buildMobiFixture>[0] = {}): Buffer {
  return readRecord(buildMobiFixture(options), 0);
}

function stringRecord(type: number, value: string): ExthRecord {
  return { type, data: Buffer.from(value, 'utf8') };
}

describe('isMobiHeaderRecord', () => {
  it('accepts a real header record', () => {
    expect(isMobiHeaderRecord(headerRecordOf())).toBe(true);
  });

  it('rejects a record without MOBI magic', () => {
    expect(isMobiHeaderRecord(Buffer.alloc(4096))).toBe(false);
  });

  it('rejects a record too short to hold the EXTH flags', () => {
    const short = Buffer.alloc(64);
    short.write('MOBI', 16, 'ascii');
    expect(isMobiHeaderRecord(short)).toBe(false);
  });
});

describe('assertWritableHeaderRecord', () => {
  it('accepts an unencrypted header', () => {
    expect(() => assertWritableHeaderRecord(headerRecordOf())).not.toThrow();
  });

  it('refuses a DRM encrypted file', () => {
    expect(() => assertWritableHeaderRecord(headerRecordOf({ encryption: 1 }))).toThrow(/DRM encrypted/);
  });

  it('refuses a record that is not a MOBI header', () => {
    expect(() => assertWritableHeaderRecord(Buffer.alloc(4096))).toThrow(/header record not found/);
  });
});

describe('readMobiHeaderRecord', () => {
  it('reads the declared header fields', () => {
    const header = readMobiHeaderRecord(
      headerRecordOf({ fileVersion: 8, encoding: MOBI_ENCODING_CP1252, mobiHeaderLength: 264, fullName: 'Fixture Book' }),
    );

    expect(header.fileVersion).toBe(8);
    expect(header.encoding).toBe(MOBI_ENCODING_CP1252);
    expect(header.mobiHeaderLength).toBe(264);
    expect(header.exthStart).toBe(16 + 264);
    expect(header.fullName.toString('utf8')).toBe('Fixture Book');
  });

  it('reads the first image index', () => {
    expect(readMobiHeaderRecord(headerRecordOf({ textRecordCount: 5 })).firstImageIndex).toBe(6);
  });

  it('parses the EXTH records', () => {
    const header = readMobiHeaderRecord(headerRecordOf({ exth: [{ type: EXTH_AUTHOR, data: 'Ada Lovelace' }] }));

    expect(header.exthRecords.find((record) => record.type === EXTH_AUTHOR)!.data.toString('utf8')).toBe('Ada Lovelace');
  });

  it('returns no EXTH records when the present flag is clear', () => {
    expect(readMobiHeaderRecord(headerRecordOf({ omitExth: true, cover: null, thumbnail: null })).exthRecords).toEqual([]);
  });

  it('returns an empty full name when the declared range is out of bounds', () => {
    const record = headerRecordOf();
    record.writeUInt32BE(record.length + 10, 84);
    expect(readMobiHeaderRecord(record).fullName).toHaveLength(0);
  });
});

describe('rebuildHeaderRecord', () => {
  const exthRecords = [stringRecord(EXTH_UPDATED_TITLE, 'New Title'), stringRecord(EXTH_AUTHOR, 'Ada Lovelace')];

  it('keeps the original record length when the content fits the trailing slack', () => {
    const original = headerRecordOf({ slack: 8192 });
    const result = rebuildHeaderRecord(original, exthRecords, Buffer.from('New Title', 'utf8'));

    expect(result.fitsOriginalSize).toBe(true);
    expect(result.record).toHaveLength(original.length);
  });

  it('grows the record when the content exceeds the slack', () => {
    const original = headerRecordOf({ slack: 0 });
    const big = [stringRecord(EXTH_UPDATED_TITLE, 'x'.repeat(5000))];
    const result = rebuildHeaderRecord(original, big, Buffer.from('x'.repeat(5000), 'utf8'));

    expect(result.fitsOriginalSize).toBe(false);
    expect(result.record.length).toBeGreaterThan(original.length);
  });

  it('writes a record length that is 4-byte aligned when it grows', () => {
    const original = headerRecordOf({ slack: 0 });
    const result = rebuildHeaderRecord(original, [stringRecord(EXTH_AUTHOR, 'x'.repeat(1001))], Buffer.from('abcde', 'utf8'));

    expect(result.fitsOriginalSize).toBe(false);
    expect(result.record.length % 4).toBe(0);
  });

  it('preserves an unaligned original length on the in-place path', () => {
    const original = headerRecordOf({ slack: 1 });
    const result = rebuildHeaderRecord(original, [stringRecord(EXTH_AUTHOR, 'A')], Buffer.from('T', 'utf8'));

    expect(result.fitsOriginalSize).toBe(true);
    expect(result.record).toHaveLength(original.length);
  });

  it('relocates the full name and updates its offset and length', () => {
    const original = headerRecordOf();
    const fullName = Buffer.from('Relocated Title', 'utf8');
    const { record } = rebuildHeaderRecord(original, exthRecords, fullName);

    const offset = record.readUInt32BE(84);
    expect(record.readUInt32BE(88)).toBe(fullName.length);
    expect(record.subarray(offset, offset + fullName.length)).toEqual(fullName);
  });

  it('aligns the full name to a 4-byte boundary', () => {
    const { record } = rebuildHeaderRecord(headerRecordOf(), [stringRecord(EXTH_AUTHOR, 'a')], Buffer.from('T', 'utf8'));

    expect(record.readUInt32BE(84) % 4).toBe(0);
  });

  it('sets the EXTH present flag when the source had no EXTH block', () => {
    const original = headerRecordOf({ omitExth: true, cover: null, thumbnail: null });
    expect(original.readUInt32BE(128) & 0x40).toBe(0);

    const { record } = rebuildHeaderRecord(original, exthRecords, Buffer.from('T', 'utf8'));

    expect(record.readUInt32BE(128) & 0x40).toBe(0x40);
    expect(parseExthBlock(record, readMobiHeaderRecord(record).exthStart)).toHaveLength(2);
  });

  it('preserves the PalmDOC and MOBI header bytes ahead of the EXTH block', () => {
    const original = headerRecordOf({ fileVersion: 8, mobiHeaderLength: 264 });
    const { record } = rebuildHeaderRecord(original, exthRecords, Buffer.from('T', 'utf8'));

    // Everything up to the full-name pointer is untouched.
    expect(record.subarray(0, 84)).toEqual(original.subarray(0, 84));
    expect(record.subarray(92, 128)).toEqual(original.subarray(92, 128));
  });

  it('writes an EXTH block that parses back to the supplied records', () => {
    const records = [stringRecord(EXTH_AUTHOR, 'Ada'), stringRecord(EXTH_LANGUAGE, 'fr')];
    const { record } = rebuildHeaderRecord(headerRecordOf(), records, Buffer.from('T', 'utf8'));

    const parsed = readMobiHeaderRecord(record).exthRecords;
    expect(parsed.map((entry) => entry.type)).toEqual([EXTH_AUTHOR, EXTH_LANGUAGE]);
  });

  it('zero-fills the slack rather than leaking stale bytes', () => {
    const original = headerRecordOf({ slack: 512, exth: [{ type: EXTH_AUTHOR, data: 'A-very-distinctive-old-author' }] });
    const { record } = rebuildHeaderRecord(original, [stringRecord(EXTH_AUTHOR, 'B')], Buffer.from('T', 'utf8'));

    expect(record.includes(Buffer.from('A-very-distinctive-old-author'))).toBe(false);
  });

  it('produces byte-identical output for the same inputs', () => {
    const original = headerRecordOf();
    const first = rebuildHeaderRecord(original, exthRecords, Buffer.from('T', 'utf8'));
    const second = rebuildHeaderRecord(first.record, exthRecords, Buffer.from('T', 'utf8'));

    expect(second.record).toEqual(first.record);
  });

  it('rejects a record that is not a MOBI header', () => {
    expect(() => rebuildHeaderRecord(Buffer.alloc(4096), exthRecords, Buffer.alloc(0))).toThrow(/header record not found/);
  });

  it('keeps the declared EXTH length consistent with the emitted block', () => {
    const { record } = rebuildHeaderRecord(headerRecordOf(), exthRecords, Buffer.from('T', 'utf8'));
    const { exthStart } = readMobiHeaderRecord(record);

    expect(record.readUInt32BE(exthStart + 4)).toBe(buildExthBlock(exthRecords).length);
  });
});
