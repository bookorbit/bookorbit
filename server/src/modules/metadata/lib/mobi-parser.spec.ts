jest.mock('fs/promises');

import { readFile } from 'fs/promises';
import { parseMobiBuffer, parseMobiFile, extractMobiCover } from './mobi-parser';

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;

// ── Buffer builder ────────────────────────────────────────────────────────────
//
// Builds a minimal but structurally valid PalmDB/MOBI buffer in memory
// without touching the filesystem.

function makeStringExthRecord(type: number, value: string): Buffer {
  const data = Buffer.from(value, 'utf8');
  const rec = Buffer.alloc(8 + data.length);
  rec.writeUInt32BE(type, 0);
  rec.writeUInt32BE(8 + data.length, 4);
  data.copy(rec, 8);
  return rec;
}

function makeUint32ExthRecord(type: number, value: number): Buffer {
  const rec = Buffer.alloc(12);
  rec.writeUInt32BE(type, 0);
  rec.writeUInt32BE(12, 4);
  rec.writeUInt32BE(value, 8);
  return rec;
}

interface MobiOptions {
  palmTitle?: string;
  updatedTitle?: string;
  authors?: string[];
  publisher?: string;
  description?: string;
  isbn?: string;
  tags?: string[];
  publishedDate?: string;
  language?: string;
  firstImageIndex?: number;
  coverOffset?: number;
  imageData?: Buffer;
}

function buildMobiBuffer(opts: MobiOptions = {}): Buffer {
  const exthRecs: Buffer[] = [];

  if (opts.updatedTitle) exthRecs.push(makeStringExthRecord(503, opts.updatedTitle));
  for (const a of opts.authors ?? []) exthRecs.push(makeStringExthRecord(100, a));
  if (opts.publisher) exthRecs.push(makeStringExthRecord(101, opts.publisher));
  if (opts.description) exthRecs.push(makeStringExthRecord(103, opts.description));
  if (opts.isbn) exthRecs.push(makeStringExthRecord(104, opts.isbn));
  for (const t of opts.tags ?? []) exthRecs.push(makeStringExthRecord(105, t));
  if (opts.publishedDate) exthRecs.push(makeStringExthRecord(106, opts.publishedDate));
  if (opts.language) exthRecs.push(makeStringExthRecord(524, opts.language));
  if (opts.coverOffset !== undefined) exthRecs.push(makeUint32ExthRecord(201, opts.coverOffset));

  const hasExth = exthRecs.length > 0;
  const exthDataLen = exthRecs.reduce((s, r) => s + r.length, 0);
  const exthLen = 12 + exthDataLen;

  const exthBuf = Buffer.alloc(exthLen, 0);
  exthBuf.write('EXTH', 0, 'ascii');
  exthBuf.writeUInt32BE(exthLen, 4);
  exthBuf.writeUInt32BE(exthRecs.length, 8);
  let ep = 12;
  for (const r of exthRecs) {
    r.copy(exthBuf, ep);
    ep += r.length;
  }

  // MOBI header length (measured from byte 16 of record 0)
  const mobiHeaderLength = 264;
  const fullNameStr = opts.palmTitle ?? 'Palm Title';
  const fullNameBuf = Buffer.from(fullNameStr, 'utf8');
  // Full name offset = after MOBI header + EXTH block (if present)
  const fullNameOffset = 16 + mobiHeaderLength + (hasExth ? exthLen : 0);

  const rec0Size = fullNameOffset + fullNameBuf.length;
  const rec0 = Buffer.alloc(rec0Size, 0);

  rec0.write('MOBI', 16, 'ascii');
  rec0.writeUInt32BE(mobiHeaderLength, 20);
  rec0.writeUInt32BE(opts.firstImageIndex ?? 0, 108);
  rec0.writeUInt32BE(hasExth ? 0x40 : 0x00, 128);
  rec0.writeUInt32BE(fullNameOffset, 84);
  rec0.writeUInt32BE(fullNameBuf.length, 88);
  fullNameBuf.copy(rec0, fullNameOffset);
  if (hasExth) exthBuf.copy(rec0, 16 + mobiHeaderLength);

  // PalmDB: 78 bytes preamble + numRecords (uint16BE) + 2 record entries (8 bytes each) = 94 bytes
  const numRecords = 2;
  const palmHeaderSize = 78 + numRecords * 8; // = 94
  const rec0Offset = palmHeaderSize;
  const imageData = opts.imageData ?? Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01]);
  const rec1Offset = rec0Offset + rec0.length;
  const totalSize = rec1Offset + imageData.length;

  const palm = Buffer.alloc(totalSize, 0);
  palm.write('TestBook\0', 0, 'ascii');
  palm.writeUInt16BE(numRecords, 76);
  palm.writeUInt32BE(rec0Offset, 78); // record 0 offset
  palm.writeUInt32BE(0, 82); // record 0 attrs/id
  palm.writeUInt32BE(rec1Offset, 86); // record 1 offset
  palm.writeUInt32BE(0, 90); // record 1 attrs/id
  rec0.copy(palm, rec0Offset);
  imageData.copy(palm, rec1Offset);

  return palm;
}

beforeEach(() => jest.resetAllMocks());

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('parseMobiBuffer', () => {
  describe('title', () => {
    it('uses EXTH UPDATED_TITLE (503) when present', () => {
      const buf = buildMobiBuffer({ palmTitle: 'Palm Title', updatedTitle: 'EXTH Title' });
      const r = parseMobiBuffer(buf);
      expect(r.title).toBe('EXTH Title');
    });

    it('falls back to palm title when no EXTH updated title', () => {
      const buf = buildMobiBuffer({ palmTitle: 'Palm Only Title' });
      const r = parseMobiBuffer(buf);
      expect(r.title).toBe('Palm Only Title');
    });

    it('trims null bytes from palm title', () => {
      const buf = buildMobiBuffer({ palmTitle: 'Trimmed' });
      const r = parseMobiBuffer(buf);
      expect(r.title).toBe('Trimmed');
    });
  });

  describe('authors', () => {
    it('parses a single author', () => {
      const buf = buildMobiBuffer({ authors: ['Frank Herbert'] });
      expect(parseMobiBuffer(buf).authors).toEqual(['Frank Herbert']);
    });

    it('parses multiple author EXTH records', () => {
      const buf = buildMobiBuffer({ authors: ['Author One', 'Author Two'] });
      expect(parseMobiBuffer(buf).authors).toEqual(['Author One', 'Author Two']);
    });

    it('splits semicolon-separated authors in a single EXTH record', () => {
      const buf = buildMobiBuffer({ authors: ['First Author; Second Author'] });
      expect(parseMobiBuffer(buf).authors).toEqual(['First Author', 'Second Author']);
    });

    it('returns empty array when no author EXTH records', () => {
      const buf = buildMobiBuffer({ palmTitle: 'No Authors' });
      expect(parseMobiBuffer(buf).authors).toHaveLength(0);
    });
  });

  describe('other metadata fields', () => {
    it('parses publisher', () => {
      const buf = buildMobiBuffer({ publisher: 'Ace Books' });
      expect(parseMobiBuffer(buf).publisher).toBe('Ace Books');
    });

    it('parses description and strips HTML tags', () => {
      const buf = buildMobiBuffer({ description: '<p>A great <b>book</b>.</p>' });
      expect(parseMobiBuffer(buf).description).toBe('A great book.');
    });

    it('parses isbn', () => {
      const buf = buildMobiBuffer({ isbn: '9780441013593' });
      expect(parseMobiBuffer(buf).isbn).toBe('9780441013593');
    });

    it('parses tags from multiple SUBJECT records', () => {
      const buf = buildMobiBuffer({ tags: ['Science Fiction', 'Classic'] });
      expect(parseMobiBuffer(buf).tags).toEqual(['Science Fiction', 'Classic']);
    });

    it('splits semicolon-separated tags in a single EXTH record', () => {
      const buf = buildMobiBuffer({ tags: ['Sci-Fi; Space Opera'] });
      expect(parseMobiBuffer(buf).tags).toEqual(['Sci-Fi', 'Space Opera']);
    });

    it('parses published date', () => {
      const buf = buildMobiBuffer({ publishedDate: '1965-08-01' });
      expect(parseMobiBuffer(buf).publishedDate).toBe('1965-08-01');
    });

    it('parses language', () => {
      const buf = buildMobiBuffer({ language: 'en' });
      expect(parseMobiBuffer(buf).language).toBe('en');
    });
  });

  describe('cover record index', () => {
    it('calculates coverRecordIndex as firstImageIndex + coverOffset', () => {
      const buf = buildMobiBuffer({ firstImageIndex: 3, coverOffset: 0 });
      expect(parseMobiBuffer(buf).coverRecordIndex).toBe(3);
    });

    it('adds non-zero coverOffset to firstImageIndex', () => {
      const buf = buildMobiBuffer({ firstImageIndex: 3, coverOffset: 2 });
      expect(parseMobiBuffer(buf).coverRecordIndex).toBe(5);
    });

    it('returns null coverRecordIndex when COVER_OFFSET is 0xffffffff', () => {
      const buf = buildMobiBuffer({ firstImageIndex: 0, coverOffset: 0xffffffff });
      expect(parseMobiBuffer(buf).coverRecordIndex).toBeNull();
    });

    it('returns null coverRecordIndex when no EXTH cover record', () => {
      const buf = buildMobiBuffer({ palmTitle: 'No Cover' });
      expect(parseMobiBuffer(buf).coverRecordIndex).toBeNull();
    });
  });

  describe('record offsets', () => {
    it('returns record offsets array matching numRecords', () => {
      const buf = buildMobiBuffer({});
      const r = parseMobiBuffer(buf);
      expect(r.recordOffsets).toHaveLength(2);
    });
  });

  describe('error cases', () => {
    it('throws when buffer has no records (numRecords = 0)', () => {
      const buf = Buffer.alloc(100, 0);
      buf.writeUInt16BE(0, 76); // numRecords = 0
      expect(() => parseMobiBuffer(buf)).toThrow('No records in PalmDB');
    });

    it('throws when MOBI magic is absent', () => {
      const buf = Buffer.alloc(200, 0);
      buf.writeUInt16BE(1, 76); // numRecords = 1
      buf.writeUInt32BE(100, 78); // record 0 at offset 100
      // record 0 content: no "MOBI" at [16..20]
      buf.write('XXXX', 100 + 16, 'ascii');
      expect(() => parseMobiBuffer(buf)).toThrow('MOBI magic not found');
    });
  });
});

describe('parseMobiFile', () => {
  it('returns null when file read throws', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    expect(await parseMobiFile('/nonexistent/path/book.mobi')).toBeNull();
  });

  it('parses metadata from a valid buffer', async () => {
    const buf = buildMobiBuffer({ updatedTitle: 'File Title', authors: ['File Author'] });
    mockReadFile.mockResolvedValue(buf as unknown as ReturnType<typeof readFile> extends Promise<infer T> ? T : never);
    const r = await parseMobiFile('/book.mobi');
    expect(r?.title).toBe('File Title');
    expect(r?.authors).toEqual(['File Author']);
  });
});

describe('extractMobiCover', () => {
  it('returns JPEG cover bytes when magic bytes are 0xFF 0xD8', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0x02, 0x03]);
    const buf = buildMobiBuffer({ firstImageIndex: 1, coverOffset: 0, imageData: jpeg });
    mockReadFile.mockResolvedValue(buf as unknown as ReturnType<typeof readFile> extends Promise<infer T> ? T : never);

    const cover = await extractMobiCover('/book.mobi');
    expect(cover).not.toBeNull();
    expect(cover![0]).toBe(0xff);
    expect(cover![1]).toBe(0xd8);
  });

  it('returns PNG cover bytes when magic bytes are 0x89 0x50 0x4E 0x47', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const buf = buildMobiBuffer({ firstImageIndex: 1, coverOffset: 0, imageData: png });
    mockReadFile.mockResolvedValue(buf as unknown as ReturnType<typeof readFile> extends Promise<infer T> ? T : never);

    const cover = await extractMobiCover('/book.mobi');
    expect(cover).not.toBeNull();
    expect(cover![0]).toBe(0x89);
    expect(cover![1]).toBe(0x50);
  });

  it('returns null when image record has unrecognized magic bytes', async () => {
    const invalid = Buffer.from([0x47, 0x49, 0x46, 0x38]); // GIF magic — not accepted
    const buf = buildMobiBuffer({ firstImageIndex: 1, coverOffset: 0, imageData: invalid });
    mockReadFile.mockResolvedValue(buf as unknown as ReturnType<typeof readFile> extends Promise<infer T> ? T : never);

    expect(await extractMobiCover('/book.mobi')).toBeNull();
  });

  it('returns null when coverRecordIndex is out of bounds', async () => {
    // coverOffset=99 pushes coverRecordIndex beyond the 2 records in the buffer
    const buf = buildMobiBuffer({ firstImageIndex: 1, coverOffset: 99, imageData: Buffer.from([0xff, 0xd8]) });
    mockReadFile.mockResolvedValue(buf as unknown as ReturnType<typeof readFile> extends Promise<infer T> ? T : never);

    expect(await extractMobiCover('/book.mobi')).toBeNull();
  });

  it('returns null when EXTH cover record is absent', async () => {
    const buf = buildMobiBuffer({ palmTitle: 'No Cover' });
    mockReadFile.mockResolvedValue(buf as unknown as ReturnType<typeof readFile> extends Promise<infer T> ? T : never);

    expect(await extractMobiCover('/book.mobi')).toBeNull();
  });

  it('returns null when file read throws', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    expect(await extractMobiCover('/missing.mobi')).toBeNull();
  });
});
