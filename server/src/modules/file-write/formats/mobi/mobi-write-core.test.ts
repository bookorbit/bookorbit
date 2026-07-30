import sharp from 'sharp';

import { MOBI_BOOK_FILE_WRITE_FIELDS } from '@bookorbit/types';
import { parseMobiBuffer } from '../../../metadata/lib/mobi-parser';
import type { BookWritePayload, BookWritePayloadKey } from '../../interfaces/book-write-payload.interface';
import { EXTH_AUTHOR, EXTH_KF8_BOUNDARY, EXTH_SUBJECT, EXTH_UPDATED_TITLE, readExthUint32 } from './mobi-exth';
import { readMobiHeaderRecord } from './mobi-header-record';
import { buildMobiFixture, fakeImageRecord, readRecord, recordCount, type MobiFixtureOptions } from './mobi-test-fixtures';
import { MOBI_ENCODING_CP1252 } from './mobi-text-encoding';
import { writeMobiMetadata } from './mobi-write-core';

const FULL_MASK: ReadonlySet<BookWritePayloadKey> = new Set(MOBI_BOOK_FILE_WRITE_FIELDS);

const PAYLOAD: BookWritePayload = {
  title: 'Written Title',
  authors: [
    { name: 'Ada Lovelace', sortName: 'Lovelace, Ada' },
    { name: 'Grace Hopper', sortName: 'Hopper, Grace' },
  ],
  publisher: 'BookOrbit Press',
  description: 'A rewritten description.',
  publishedDate: '2019-03-04T00:00:00+00:00',
  language: 'fr',
  isbn13: '9781234567897',
  genres: ['Fiction'],
  tags: ['Testing'],
};

function exthOf(buf: Buffer, recordIndex = 0) {
  return readMobiHeaderRecord(readRecord(buf, recordIndex)).exthRecords;
}

function exthStrings(buf: Buffer, type: number, recordIndex = 0): string[] {
  return exthOf(buf, recordIndex)
    .filter((record) => record.type === type)
    .map((record) => record.data.toString('utf8'));
}

async function write(fixture: Buffer, payload: BookWritePayload = PAYLOAD, mask = FULL_MASK) {
  return writeMobiMetadata(fixture, payload, mask);
}

async function solidCover(width = 600, height = 900): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } } })
    .png()
    .toBuffer();
}

describe('writeMobiMetadata: field mapping', () => {
  it('writes every supported field into its EXTH slot', async () => {
    const { buffer } = await write(buildMobiFixture());
    const parsed = parseMobiBuffer(buffer);

    expect(parsed.title).toBe('Written Title');
    expect(parsed.authors).toEqual(['Ada Lovelace', 'Grace Hopper']);
    expect(parsed.publisher).toBe('BookOrbit Press');
    expect(parsed.description).toBe('A rewritten description.');
    expect(parsed.publishedDate).toBe('2019-03-04T00:00:00+00:00');
    expect(parsed.language).toBe('fr');
    expect(parsed.isbn).toBe('9781234567897');
    expect(parsed.tags).toEqual(['Fiction', 'Testing']);
  });

  it('reports exactly the fields it wrote', async () => {
    const { fieldsWritten } = await write(buildMobiFixture());

    expect([...fieldsWritten].sort()).toEqual(
      ['authors', 'description', 'genres', 'isbn13', 'language', 'publishedDate', 'publisher', 'tags', 'title'].sort(),
    );
  });

  it('writes one EXTH record per author', async () => {
    const { buffer } = await write(buildMobiFixture());

    expect(exthStrings(buffer, EXTH_AUTHOR)).toEqual(['Ada Lovelace', 'Grace Hopper']);
  });

  it('merges genres and tags into a single subject record the parser can split', async () => {
    const { buffer } = await write(buildMobiFixture(), { genres: ['Horror', 'Crime'], tags: ['Owned'] });

    expect(exthStrings(buffer, EXTH_SUBJECT)).toEqual(['Horror; Crime; Owned']);
    expect(parseMobiBuffer(buffer).tags).toEqual(['Horror', 'Crime', 'Owned']);
  });

  it('deduplicates a value that appears in both genres and tags', async () => {
    const { buffer } = await write(buildMobiFixture(), { genres: ['Horror'], tags: ['Horror', 'Owned'] });

    expect(exthStrings(buffer, EXTH_SUBJECT)).toEqual(['Horror; Owned']);
  });

  it('prefers isbn13 over isbn10 for the single ISBN slot', async () => {
    const { buffer, fieldsWritten } = await write(buildMobiFixture(), { isbn13: '9781234567897', isbn10: '1234567897' });

    expect(parseMobiBuffer(buffer).isbn).toBe('9781234567897');
    expect(fieldsWritten).toContain('isbn13');
    expect(fieldsWritten).not.toContain('isbn10');
  });

  it('falls back to isbn10 when isbn13 is absent', async () => {
    const { buffer, fieldsWritten } = await write(buildMobiFixture(), { isbn10: '1234567897' });

    expect(parseMobiBuffer(buffer).isbn).toBe('1234567897');
    expect(fieldsWritten).toEqual(['isbn10']);
  });

  it('writes the title as both the updated-title record and the record-0 full name', async () => {
    const { buffer } = await write(buildMobiFixture(), { title: 'Dual Written Title' });
    const header = readMobiHeaderRecord(readRecord(buffer, 0));

    expect(exthStrings(buffer, EXTH_UPDATED_TITLE)).toEqual(['Dual Written Title']);
    expect(header.fullName.toString('utf8')).toBe('Dual Written Title');
  });

  it('keeps the existing full name when the title is not being written', async () => {
    const fixture = buildMobiFixture({ fullName: 'Original Name' });
    const { buffer } = await write(fixture, { publisher: 'Press' });

    expect(readMobiHeaderRecord(readRecord(buffer, 0)).fullName.toString('utf8')).toBe('Original Name');
  });

  it('trims whitespace and ignores blank values', async () => {
    const { buffer, fieldsWritten } = await write(buildMobiFixture(), { title: '  Padded  ', publisher: '   ' });

    expect(parseMobiBuffer(buffer).title).toBe('Padded');
    expect(fieldsWritten).toEqual(['title']);
  });

  it('ignores blank author names', async () => {
    const { buffer } = await write(buildMobiFixture(), {
      authors: [
        { name: '  ', sortName: null },
        { name: ' Ada ', sortName: null },
      ],
    });

    expect(exthStrings(buffer, EXTH_AUTHOR)).toEqual(['Ada']);
  });

  it('writes nothing and reports no fields for an empty payload', async () => {
    const fixture = buildMobiFixture();
    const { fieldsWritten, buffer } = await write(fixture, {});

    expect(fieldsWritten).toEqual([]);
    expect(parseMobiBuffer(buffer).title).toBe(parseMobiBuffer(fixture).title);
  });
});

describe('writeMobiMetadata: field mask', () => {
  it('only writes fields present in the mask', async () => {
    const { buffer, fieldsWritten } = await write(buildMobiFixture(), PAYLOAD, new Set(['title', 'publisher']));
    const parsed = parseMobiBuffer(buffer);

    expect(fieldsWritten.sort()).toEqual(['publisher', 'title']);
    expect(parsed.title).toBe('Written Title');
    expect(parsed.publisher).toBe('BookOrbit Press');
    expect(parsed.authors).toEqual([]);
  });

  it('never writes a field outside the MOBI-supported set even if masked in', async () => {
    const { fieldsWritten } = await write(buildMobiFixture(), { ...PAYLOAD, seriesName: 'Some Series' }, new Set(['seriesName']));

    expect(fieldsWritten).toEqual([]);
  });

  it('removes a stale managed record when the field is masked in but empty', async () => {
    const fixture = buildMobiFixture({ exth: [{ type: EXTH_AUTHOR, data: 'Stale Author' }] });
    const { buffer } = await write(fixture, { title: 'New' });

    expect(exthStrings(buffer, EXTH_AUTHOR)).toEqual([]);
  });
});

describe('writeMobiMetadata: EXTH preservation', () => {
  it('preserves unmanaged records verbatim and in order', async () => {
    const fixture = buildMobiFixture({
      exth: [
        { type: 113, data: 'uuid-value' },
        { type: 501, data: 'EBOK' },
        { type: 129, data: 'kindle:embed:0001' },
      ],
    });

    const { buffer } = await write(fixture);
    const preserved = exthOf(buffer)
      .filter((record) => [113, 501, 129].includes(record.type))
      .map((record) => `${record.type}:${record.data.toString('utf8')}`);

    expect(preserved).toEqual(['113:uuid-value', '129:kindle:embed:0001', '501:EBOK']);
  });

  it('replaces rather than duplicates a managed record that already exists', async () => {
    const fixture = buildMobiFixture({
      exth: [
        { type: EXTH_UPDATED_TITLE, data: 'Old Title' },
        { type: EXTH_AUTHOR, data: 'Old Author' },
      ],
    });

    const { buffer } = await write(fixture);

    expect(exthStrings(buffer, EXTH_UPDATED_TITLE)).toEqual(['Written Title']);
    expect(exthStrings(buffer, EXTH_AUTHOR)).toEqual(['Ada Lovelace', 'Grace Hopper']);
  });

  it('leaves the cover and thumbnail offsets untouched when writing metadata only', async () => {
    const fixture = buildMobiFixture();
    const before = readMobiHeaderRecord(readRecord(fixture, 0));

    const { buffer } = await write(fixture);
    const after = readMobiHeaderRecord(readRecord(buffer, 0));

    expect(readExthUint32(after.exthRecords, 201)).toBe(readExthUint32(before.exthRecords, 201));
    expect(readExthUint32(after.exthRecords, 202)).toBe(readExthUint32(before.exthRecords, 202));
    expect(after.firstImageIndex).toBe(before.firstImageIndex);
  });
});

describe('writeMobiMetadata: write modes', () => {
  it('writes in place when the metadata fits the record-0 slack', async () => {
    const fixture = buildMobiFixture({ slack: 8192 });
    const { buffer, mode } = await write(fixture);

    expect(mode).toBe('in-place');
    expect(buffer.length).toBe(fixture.length);
  });

  it('leaves every record except the header byte-identical when writing in place', async () => {
    const fixture = buildMobiFixture({ slack: 8192 });
    const { buffer } = await write(fixture);

    for (let i = 1; i < recordCount(fixture); i++) {
      expect(readRecord(buffer, i)).toEqual(readRecord(fixture, i));
    }
  });

  it('falls back to a full rewrite when the metadata exceeds the slack', async () => {
    const fixture = buildMobiFixture({ slack: 64 });
    const { buffer, mode } = await write(fixture, { ...PAYLOAD, description: 'x'.repeat(20_000) });

    expect(mode).toBe('rewrite');
    expect(buffer.length).toBeGreaterThan(fixture.length);
  });

  it('preserves record count, order, and contents through a rewrite', async () => {
    const fixture = buildMobiFixture({ slack: 0 });
    const { buffer } = await write(fixture, { ...PAYLOAD, description: 'y'.repeat(20_000) });

    expect(recordCount(buffer)).toBe(recordCount(fixture));
    for (let i = 1; i < recordCount(fixture); i++) {
      expect(readRecord(buffer, i)).toEqual(readRecord(fixture, i));
    }
  });

  it('handles a header record with no slack at all', async () => {
    const { buffer } = await write(buildMobiFixture({ slack: 0 }));

    expect(parseMobiBuffer(buffer).title).toBe('Written Title');
  });
});

describe('writeMobiMetadata: dual-format files', () => {
  it('patches both header records when EXTH 121 marks a real KF8 boundary', async () => {
    const fixture = buildMobiFixture({ fileVersion: 6, kf8Header: { fullName: 'KF8 Name' } });
    const { buffer, patchedHeaderRecords } = await write(fixture);

    expect(patchedHeaderRecords).toHaveLength(2);
    const boundary = patchedHeaderRecords[1]!;
    expect(exthStrings(buffer, EXTH_UPDATED_TITLE, 0)).toEqual(['Written Title']);
    expect(exthStrings(buffer, EXTH_UPDATED_TITLE, boundary)).toEqual(['Written Title']);
  });

  it('ignores EXTH 121 in a KF8-only file, where it points at an ordinary record', async () => {
    // Real .azw3 files carry a 121 record aimed at text, font, or index records.
    const fixture = buildMobiFixture({ fileVersion: 8, kf8BoundaryOverride: 2 });
    const { buffer, patchedHeaderRecords } = await write(fixture);

    expect(patchedHeaderRecords).toEqual([0]);
    expect(readRecord(buffer, 2)).toEqual(readRecord(fixture, 2));
  });

  it('ignores a boundary index that is out of range', async () => {
    const fixture = buildMobiFixture({ fileVersion: 6, kf8BoundaryOverride: 9999 });

    expect((await write(fixture)).patchedHeaderRecords).toEqual([0]);
  });

  it('ignores the sentinel boundary value', async () => {
    const fixture = buildMobiFixture({ fileVersion: 6, kf8BoundaryOverride: 0xffffffff });

    expect((await write(fixture)).patchedHeaderRecords).toEqual([0]);
  });

  it('ignores a boundary that points at a record without MOBI magic', async () => {
    const fixture = buildMobiFixture({ fileVersion: 6, kf8BoundaryOverride: 1 });

    expect((await write(fixture)).patchedHeaderRecords).toEqual([0]);
  });

  it('keeps the boundary record itself pointing at the same index after a rewrite', async () => {
    const fixture = buildMobiFixture({ fileVersion: 6, kf8Header: {}, slack: 0 });
    const boundaryBefore = readExthUint32(exthOf(fixture), EXTH_KF8_BOUNDARY);

    const { buffer } = await write(fixture, { ...PAYLOAD, description: 'z'.repeat(20_000) });

    expect(readExthUint32(exthOf(buffer), EXTH_KF8_BOUNDARY)).toBe(boundaryBefore);
    expect(readMobiHeaderRecord(readRecord(buffer, boundaryBefore!))).toBeTruthy();
  });
});

describe('writeMobiMetadata: text encoding', () => {
  it('writes UTF-8 metadata into a UTF-8 file without loss', async () => {
    const { buffer, lossyChars } = await write(buildMobiFixture(), { title: 'Übergrößen Café — 東京物語' });

    expect(lossyChars).toBe(0);
    expect(parseMobiBuffer(buffer).title).toBe('Übergrößen Café — 東京物語');
  });

  it('encodes into cp1252 when the file declares that code page', async () => {
    const fixture = buildMobiFixture({ encoding: MOBI_ENCODING_CP1252 });
    const { buffer, lossyChars } = await write(fixture, { title: 'Café — “quoted”' });

    expect(lossyChars).toBe(0);
    const title = exthOf(buffer).find((record) => record.type === EXTH_UPDATED_TITLE)!.data;
    expect(title).toEqual(Buffer.from([0x43, 0x61, 0x66, 0xe9, 0x20, 0x97, 0x20, 0x93, ...Buffer.from('quoted'), 0x94]));
  });

  it('substitutes unrepresentable characters and counts them, still reporting the field as written', async () => {
    const fixture = buildMobiFixture({ encoding: MOBI_ENCODING_CP1252 });
    const { lossyChars, fieldsWritten } = await write(fixture, { title: '東京物語' });

    // The title is encoded once and reused for both EXTH 503 and the full name,
    // so each lost character is counted a single time.
    expect(lossyChars).toBe(4);
    expect(fieldsWritten).toEqual(['title']);
  });

  it('counts lossy characters across every affected field', async () => {
    const fixture = buildMobiFixture({ encoding: MOBI_ENCODING_CP1252 });
    const { lossyChars } = await write(fixture, { publisher: '東京', description: '物語' });

    expect(lossyChars).toBe(4);
  });

  it('reports no loss for a cp1252 file whose metadata is plain ASCII', async () => {
    const fixture = buildMobiFixture({ encoding: MOBI_ENCODING_CP1252 });

    expect((await write(fixture, { title: 'Plain ASCII' })).lossyChars).toBe(0);
  });
});

describe('writeMobiMetadata: cover', () => {
  it('replaces the cover and thumbnail records and reports the field', async () => {
    const fixture = buildMobiFixture();
    const { buffer, fieldsWritten, mode } = await write(fixture, { coverBytes: await solidCover() });

    expect(fieldsWritten).toEqual(['coverBytes']);
    expect(mode).toBe('rewrite');
    expect(readRecord(buffer, 4).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(readRecord(buffer, 4)).not.toEqual(readRecord(fixture, 4));
    expect(readRecord(buffer, 5)).not.toEqual(readRecord(fixture, 5));
  });

  it('leaves the cover offsets and first image index untouched', async () => {
    const fixture = buildMobiFixture();
    const { buffer } = await write(fixture, { coverBytes: await solidCover() });
    const header = readMobiHeaderRecord(readRecord(buffer, 0));

    expect(readExthUint32(header.exthRecords, 201)).toBe(0);
    expect(readExthUint32(header.exthRecords, 202)).toBe(1);
    expect(header.firstImageIndex).toBe(4);
  });

  it('remains readable by the in-repo cover extractor', async () => {
    const fixture = buildMobiFixture();
    const { buffer } = await write(fixture, { coverBytes: await solidCover() });
    const parsed = parseMobiBuffer(buffer);

    expect(parsed.coverRecordIndex).toBe(4);
    expect(readRecord(buffer, parsed.coverRecordIndex!).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });

  it('writes a thumbnail smaller than the cover', async () => {
    const fixture = buildMobiFixture();
    const { buffer } = await write(fixture, { coverBytes: await solidCover(1200, 1800) });

    expect(readRecord(buffer, 5).length).toBeLessThan(readRecord(buffer, 4).length);
  });

  it('preserves every non-image record when replacing the cover', async () => {
    const fixture = buildMobiFixture();
    const { buffer } = await write(fixture, { coverBytes: await solidCover() });

    for (const index of [1, 2, 3, 6, 7, 8]) {
      expect(readRecord(buffer, index)).toEqual(readRecord(fixture, index));
    }
  });

  it('skips the cover when the field mask excludes it', async () => {
    const fixture = buildMobiFixture();
    const { buffer, fieldsWritten } = await write(fixture, { title: 'T', coverBytes: await solidCover() }, new Set(['title']));

    expect(fieldsWritten).toEqual(['title']);
    expect(readRecord(buffer, 4)).toEqual(readRecord(fixture, 4));
  });

  it('writes metadata but skips the cover when the file has no cover record', async () => {
    const fixture = buildMobiFixture({ cover: null, thumbnail: null });
    const { buffer, fieldsWritten } = await write(fixture, { title: 'T', coverBytes: await solidCover() });

    expect(fieldsWritten).toEqual(['title']);
    expect(parseMobiBuffer(buffer).title).toBe('T');
  });

  it('skips the cover when the referenced record is not an image', async () => {
    const fixture = buildMobiFixture({ cover: Buffer.alloc(256, 0x30), thumbnail: null });
    const { fieldsWritten } = await write(fixture, { title: 'T', coverBytes: await solidCover() });

    expect(fieldsWritten).toEqual(['title']);
  });

  it('replaces only the cover when the thumbnail slot is unusable', async () => {
    const fixture = buildMobiFixture({ thumbnail: null });
    const { buffer, fieldsWritten } = await write(fixture, { coverBytes: await solidCover() });

    expect(fieldsWritten).toEqual(['coverBytes']);
    expect(readRecord(buffer, 4).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });

  it('ignores an empty cover buffer', async () => {
    const fixture = buildMobiFixture();
    const { fieldsWritten } = await write(fixture, { title: 'T', coverBytes: Buffer.alloc(0) });

    expect(fieldsWritten).toEqual(['title']);
  });
});

describe('writeMobiMetadata: safety and stability', () => {
  it('is idempotent, so repeated syncs are a no-op', async () => {
    const fixture = buildMobiFixture();
    const first = await write(fixture);
    const second = await write(first.buffer);

    expect(second.buffer).toEqual(first.buffer);
  });

  it('is idempotent through the rewrite path as well', async () => {
    const fixture = buildMobiFixture({ slack: 0 });
    const payload = { ...PAYLOAD, description: 'q'.repeat(20_000) };
    const first = await write(fixture, payload);
    const second = await write(first.buffer, payload);

    expect(second.buffer).toEqual(first.buffer);
  });

  it('never mutates the source buffer', async () => {
    const fixture = buildMobiFixture();
    const snapshot = Buffer.from(fixture);
    await write(fixture);

    expect(fixture).toEqual(snapshot);
  });

  it('refuses a DRM encrypted file', async () => {
    await expect(write(buildMobiFixture({ encryption: 1 }))).rejects.toThrow(/DRM encrypted/);
  });

  it('refuses a file whose record 0 is not a MOBI header', async () => {
    const fixture = buildMobiFixture();
    readRecord(fixture, 0).write('XXXX', 16, 'ascii');

    await expect(write(fixture)).rejects.toThrow(/header record not found/);
  });

  it.each([
    ['appInfoId', 52],
    ['sortInfoId', 56],
  ])('refuses a file with a %s area', async (_label, offset) => {
    const fixture = buildMobiFixture();
    fixture.writeUInt32BE(2048, offset);

    await expect(write(fixture)).rejects.toThrow(/appInfo\/sortInfo/);
  });

  it('writes a file that still parses with the in-repo reader after a rewrite', async () => {
    const fixture = buildMobiFixture({ slack: 0, cover: fakeImageRecord(4096, 0x33) });
    const { buffer } = await write(fixture, { ...PAYLOAD, description: 'w'.repeat(30_000) });
    const parsed = parseMobiBuffer(buffer);

    expect(parsed.title).toBe('Written Title');
    expect(parsed.coverRecordIndex).toBe(4);
    expect(parsed.recordOffsets).toHaveLength(recordCount(fixture));
  });

  it.each<[string, MobiFixtureOptions]>([
    ['MOBI6', { fileVersion: 6, mobiHeaderLength: 232 }],
    ['KF8', { fileVersion: 8, mobiHeaderLength: 264 }],
    ['short header', { fileVersion: 8, mobiHeaderLength: 256 }],
    ['version 7', { fileVersion: 7, mobiHeaderLength: 232 }],
  ])('writes a %s layout', async (_label, options) => {
    const { buffer } = await write(buildMobiFixture(options));

    expect(parseMobiBuffer(buffer).title).toBe('Written Title');
  });
});
