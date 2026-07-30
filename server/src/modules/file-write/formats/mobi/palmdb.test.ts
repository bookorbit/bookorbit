import { buildMobiFixture, readRecord, recordCount } from './mobi-test-fixtures';
import { assertWritablePalmDb, patchRecordsInPlace, readRecordOffsets, rebuildWithRecords, sliceRecord } from './palmdb';

describe('readRecordOffsets', () => {
  it('reads every record offset in order', () => {
    const buf = buildMobiFixture();
    const offsets = readRecordOffsets(buf);

    expect(offsets).toHaveLength(recordCount(buf));
    expect(offsets[0]).toBe(78 + offsets.length * 8 + 2);
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]).toBeGreaterThanOrEqual(offsets[i - 1]!);
    }
  });

  it('rejects a truncated PalmDB header', () => {
    expect(() => readRecordOffsets(Buffer.alloc(40))).toThrow(/truncated/);
  });

  it('rejects a file with no records', () => {
    const buf = Buffer.alloc(200);
    buf.writeUInt16BE(0, 76);
    expect(() => readRecordOffsets(buf)).toThrow(/no records/);
  });

  it('rejects a record list that runs past the end of the file', () => {
    const buf = buildMobiFixture();
    buf.writeUInt16BE(50_000, 76);
    expect(() => readRecordOffsets(buf)).toThrow(/truncated/);
  });

  it('rejects an offset pointing beyond the file', () => {
    const buf = buildMobiFixture();
    buf.writeUInt32BE(buf.length + 1, 78 + 8);
    expect(() => readRecordOffsets(buf)).toThrow(/out of bounds/);
  });

  it('rejects offsets that move backwards', () => {
    const buf = buildMobiFixture();
    buf.writeUInt32BE(1, 78 + 8);
    expect(() => readRecordOffsets(buf)).toThrow(/decreases/);
  });
});

describe('assertWritablePalmDb', () => {
  it('accepts a file with no appInfo or sortInfo area', () => {
    expect(() => assertWritablePalmDb(buildMobiFixture())).not.toThrow();
  });

  it.each([
    ['appInfoId', 52],
    ['sortInfoId', 56],
  ])('refuses when %s is set, because it is an absolute byte offset', (_label, offset) => {
    const buf = buildMobiFixture();
    buf.writeUInt32BE(1024, offset);
    expect(() => assertWritablePalmDb(buf)).toThrow(/appInfo\/sortInfo/);
  });
});

describe('sliceRecord', () => {
  it('returns the bytes of a record', () => {
    const buf = buildMobiFixture();
    const offsets = readRecordOffsets(buf);
    expect(sliceRecord(buf, offsets, 0).subarray(16, 20).toString('ascii')).toBe('MOBI');
  });

  it('returns the tail of the file for the last record', () => {
    const buf = buildMobiFixture();
    const offsets = readRecordOffsets(buf);
    const last = sliceRecord(buf, offsets, offsets.length - 1);
    expect(last).toEqual(Buffer.from([0xe9, 0x8e, 0x0d, 0x0a]));
  });

  it('throws for an index that does not exist', () => {
    const buf = buildMobiFixture();
    const offsets = readRecordOffsets(buf);
    expect(() => sliceRecord(buf, offsets, offsets.length)).toThrow(/does not exist/);
  });
});

describe('patchRecordsInPlace', () => {
  it('replaces a record and leaves every other byte identical', () => {
    const buf = buildMobiFixture();
    const offsets = readRecordOffsets(buf);
    const original = sliceRecord(buf, offsets, 2);
    const replacement = Buffer.alloc(original.length, 0x7f);

    const out = patchRecordsInPlace(buf, offsets, new Map([[2, replacement]]));

    expect(out.length).toBe(buf.length);
    expect(readRecord(out, 2)).toEqual(replacement);
    for (let i = 0; i < offsets.length; i++) {
      if (i === 2) continue;
      expect(readRecord(out, i)).toEqual(readRecord(buf, i));
    }
  });

  it('refuses a replacement of a different length', () => {
    const buf = buildMobiFixture();
    const offsets = readRecordOffsets(buf);
    expect(() => patchRecordsInPlace(buf, offsets, new Map([[2, Buffer.alloc(1)]]))).toThrow(/changes record 2 length/);
  });
});

describe('rebuildWithRecords', () => {
  it('recomputes the offset table when a record grows', () => {
    const buf = buildMobiFixture();
    const offsets = readRecordOffsets(buf);
    const grown = Buffer.alloc(sliceRecord(buf, offsets, 2).length + 500, 0x2a);

    const out = rebuildWithRecords(buf, offsets, new Map([[2, grown]]));
    const newOffsets = readRecordOffsets(out);

    expect(out.length).toBe(buf.length + 500);
    expect(newOffsets).toHaveLength(offsets.length);
    expect(readRecord(out, 2)).toEqual(grown);
    // Records before the change keep their offsets; later ones shift by exactly the delta.
    expect(newOffsets.slice(0, 3)).toEqual(offsets.slice(0, 3));
    for (let i = 3; i < offsets.length; i++) {
      expect(newOffsets[i]).toBe(offsets[i]! + 500);
    }
  });

  it('preserves the contents and order of untouched records', () => {
    const buf = buildMobiFixture();
    const offsets = readRecordOffsets(buf);
    const out = rebuildWithRecords(buf, offsets, new Map([[1, Buffer.alloc(10, 0x01)]]));

    for (let i = 2; i < offsets.length; i++) {
      expect(readRecord(out, i)).toEqual(readRecord(buf, i));
    }
  });

  it('preserves the 2-byte gap between the record list and the first record', () => {
    const buf = buildMobiFixture();
    const offsets = readRecordOffsets(buf);
    const out = rebuildWithRecords(buf, offsets, new Map([[1, Buffer.alloc(200, 0x03)]]));

    const newOffsets = readRecordOffsets(out);
    expect(newOffsets[0]! - (78 + newOffsets.length * 8)).toBe(2);
  });

  it('is a byte-identical copy when nothing is replaced', () => {
    const buf = buildMobiFixture();
    expect(rebuildWithRecords(buf, readRecordOffsets(buf), new Map())).toEqual(buf);
  });
});
