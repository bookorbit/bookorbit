vi.mock('fs/promises', () => ({ open: vi.fn() }));
vi.mock('fs', () => ({ createReadStream: vi.fn() }));
vi.mock('zlib', async () => {
  const actual = await vi.importActual<typeof import('zlib')>('zlib');
  return { ...actual, createInflateRaw: vi.fn() };
});

import { createReadStream } from 'fs';
import { open } from 'fs/promises';
import { createInflateRaw, deflateRawSync } from 'zlib';
import { createCbzZipEntryReadStream, extractCbzZipEntry, isSupportedCbzZipCompression, readCbzZipIndex } from './cbz-zip-reader';

const mockOpen = open as MockedFunction<typeof open>;
const mockCreateReadStream = createReadStream as unknown as MockedFunction<typeof createReadStream>;
const mockCreateInflateRaw = createInflateRaw as unknown as MockedFunction<typeof createInflateRaw>;
const UINT32_MAX = 0xffffffff;

interface ZipEntrySpec {
  name: string;
  data: Buffer;
  compression?: 0 | 8 | 99;
  dataDescriptor?: boolean;
}

interface Segment {
  offset: number;
  data: Buffer;
}

function payloadFor(entry: ZipEntrySpec): Buffer {
  return entry.compression === 8 ? deflateRawSync(entry.data) : entry.data;
}

function localHeader(entry: ZipEntrySpec): Buffer {
  const name = Buffer.from(entry.name, 'utf-8');
  const payload = payloadFor(entry);
  const header = Buffer.alloc(30 + name.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(entry.dataDescriptor ? 0x0008 : 0, 6);
  header.writeUInt16LE(entry.compression ?? 0, 8);
  header.writeUInt32LE(entry.dataDescriptor ? 0 : payload.length, 18);
  header.writeUInt32LE(entry.dataDescriptor ? 0 : entry.data.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  name.copy(header, 30);
  return header;
}

function centralDirectoryEntry(entry: ZipEntrySpec, localHeaderOffset: number, options?: { zip64LocalHeaderOffset?: boolean }): Buffer {
  const name = Buffer.from(entry.name, 'utf-8');
  const payload = payloadFor(entry);
  const extra = options?.zip64LocalHeaderOffset ? Buffer.alloc(12) : Buffer.alloc(0);
  if (options?.zip64LocalHeaderOffset) {
    extra.writeUInt16LE(0x0001, 0);
    extra.writeUInt16LE(8, 2);
    extra.writeBigUInt64LE(BigInt(localHeaderOffset), 4);
  }

  const header = Buffer.alloc(46 + name.length + extra.length);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(entry.dataDescriptor ? 0x0008 : 0, 8);
  header.writeUInt16LE(entry.compression ?? 0, 10);
  header.writeUInt32LE(payload.length, 20);
  header.writeUInt32LE(entry.data.length, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(extra.length, 30);
  header.writeUInt32LE(options?.zip64LocalHeaderOffset ? UINT32_MAX : localHeaderOffset, 42);
  name.copy(header, 46);
  extra.copy(header, 46 + name.length);
  return header;
}

function eocd(cdOffset: number, cdSize: number, entryCount: number, comment?: string, options?: { zip64?: boolean }): Buffer {
  const commentBuf = Buffer.from(comment ?? '', 'utf-8');
  const header = Buffer.alloc(22 + commentBuf.length);
  header.writeUInt32LE(0x06054b50, 0);
  header.writeUInt16LE(entryCount, 8);
  header.writeUInt16LE(entryCount, 10);
  header.writeUInt32LE(cdSize, 12);
  header.writeUInt32LE(options?.zip64 ? UINT32_MAX : cdOffset, 16);
  header.writeUInt16LE(commentBuf.length, 20);
  commentBuf.copy(header, 22);
  return header;
}

function zip64Eocd(cdOffset: number, cdSize: number, entryCount: number): Buffer {
  const header = Buffer.alloc(56);
  header.writeUInt32LE(0x06064b50, 0);
  header.writeBigUInt64LE(44n, 4);
  header.writeUInt16LE(45, 12);
  header.writeUInt16LE(45, 14);
  header.writeBigUInt64LE(BigInt(entryCount), 24);
  header.writeBigUInt64LE(BigInt(entryCount), 32);
  header.writeBigUInt64LE(BigInt(cdSize), 40);
  header.writeBigUInt64LE(BigInt(cdOffset), 48);
  return header;
}

function zip64Locator(zip64EocdOffset: number): Buffer {
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x07064b50, 0);
  header.writeBigUInt64LE(BigInt(zip64EocdOffset), 8);
  header.writeUInt32LE(1, 16);
  return header;
}

function buildZip(entries: ZipEntrySpec[], comment?: string): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const header = localHeader(entry);
    const payload = payloadFor(entry);
    localChunks.push(header, payload);
    centralChunks.push(centralDirectoryEntry(entry, localOffset));
    localOffset += header.length + payload.length;
  }

  const centralDirectory = Buffer.concat(centralChunks);
  return Buffer.concat([...localChunks, centralDirectory, eocd(localOffset, centralDirectory.length, entries.length, comment)]);
}

function mockSparseFile(fileSize: number, segments: Segment[]): void {
  mockOpen.mockImplementation(() => {
    const handle = {
      stat: vi.fn().mockResolvedValue({ size: fileSize }),
      close: vi.fn().mockResolvedValue(undefined),
      read: vi.fn((target: Buffer, targetOffset: number, length: number, position: number) => {
        if (position >= fileSize) return Promise.resolve({ bytesRead: 0, buffer: target });
        const bytesRead = Math.min(length, fileSize - position);
        target.fill(0, targetOffset, targetOffset + bytesRead);

        for (const segment of segments) {
          const readStart = position;
          const readEnd = position + bytesRead;
          const segmentStart = segment.offset;
          const segmentEnd = segment.offset + segment.data.length;
          const overlapStart = Math.max(readStart, segmentStart);
          const overlapEnd = Math.min(readEnd, segmentEnd);
          if (overlapStart >= overlapEnd) continue;

          segment.data.copy(target, targetOffset + (overlapStart - readStart), overlapStart - segmentStart, overlapEnd - segmentStart);
        }

        return Promise.resolve({ bytesRead, buffer: target });
      }),
    };
    return Promise.resolve(handle as unknown as Awaited<ReturnType<typeof open>>);
  });
}

function mockBufferFile(buf: Buffer): void {
  mockSparseFile(buf.length, [{ offset: 0, data: buf }]);
}

describe('cbz-zip-reader', () => {
  beforeEach(() => vi.resetAllMocks());

  it('indexes a CBZ and extracts stored and deflated entries without full-file reads', async () => {
    const buf = buildZip(
      [
        { name: 'ComicInfo.xml', data: Buffer.from('<ComicInfo><Title>Stored</Title></ComicInfo>') },
        { name: 'pages/001.jpg', data: Buffer.from([1, 2, 3, 4]), compression: 8, dataDescriptor: true },
      ],
      'bookorbit-comment',
    );
    mockBufferFile(buf);

    const index = await readCbzZipIndex('/books/comic.cbz');

    expect(index?.comment).toBe('bookorbit-comment');
    expect(index?.entries.map((entry) => entry.name)).toEqual(['ComicInfo.xml', 'pages/001.jpg']);
    expect(index?.entries[1].compressedSize).toBeGreaterThan(0);
    await expect(extractCbzZipEntry('/books/comic.cbz', index!.entries[0])).resolves.toEqual(
      Buffer.from('<ComicInfo><Title>Stored</Title></ComicInfo>'),
    );
    await expect(extractCbzZipEntry('/books/comic.cbz', index!.entries[1])).resolves.toEqual(Buffer.from([1, 2, 3, 4]));
    expect(mockOpen).toHaveBeenCalled();
  });

  it('returns null for invalid central directory bounds', async () => {
    const buf = buildZip([{ name: '001.jpg', data: Buffer.from([1]) }]);
    const eocdOffset = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    buf.writeUInt32LE(buf.length + 1, eocdOffset + 16);
    mockBufferFile(buf);

    await expect(readCbzZipIndex('/books/bad.cbz')).resolves.toBeNull();
  });

  it('indexes and extracts an entry whose offsets are above the 2 GiB readFile limit', async () => {
    const entry = { name: '001.jpg', data: Buffer.from([0xaa, 0xbb, 0xcc]) };
    const localOffset = 2_200_000_000;
    const local = localHeader(entry);
    const centralOffset = localOffset + local.length + entry.data.length;
    const central = centralDirectoryEntry(entry, localOffset);
    const end = eocd(centralOffset, central.length, 1);
    const fileSize = centralOffset + central.length + end.length;

    mockSparseFile(fileSize, [
      { offset: localOffset, data: local },
      { offset: localOffset + local.length, data: entry.data },
      { offset: centralOffset, data: central },
      { offset: centralOffset + central.length, data: end },
    ]);

    const index = await readCbzZipIndex('/books/large.cbz');

    expect(index?.entries).toHaveLength(1);
    expect(index?.entries[0]).toMatchObject({
      name: '001.jpg',
      localHeaderOffset: localOffset,
      dataStart: localOffset + local.length,
      compressedSize: entry.data.length,
    });
    await expect(extractCbzZipEntry('/books/large.cbz', index!.entries[0])).resolves.toEqual(entry.data);
  });

  it('parses ZIP64 central directory and entry offsets above 4 GiB', async () => {
    const entry = { name: '001.jpg', data: Buffer.from([0x42]) };
    const localOffset = 5_000_000_000;
    const local = localHeader(entry);
    const centralOffset = localOffset + local.length + entry.data.length;
    const central = centralDirectoryEntry(entry, localOffset, { zip64LocalHeaderOffset: true });
    const zip64 = zip64Eocd(centralOffset, central.length, 1);
    const locator = zip64Locator(centralOffset + central.length);
    const end = eocd(centralOffset, central.length, 1, undefined, { zip64: true });
    const fileSize = centralOffset + central.length + zip64.length + locator.length + end.length;

    mockSparseFile(fileSize, [
      { offset: localOffset, data: local },
      { offset: localOffset + local.length, data: entry.data },
      { offset: centralOffset, data: central },
      { offset: centralOffset + central.length, data: zip64 },
      { offset: centralOffset + central.length + zip64.length, data: locator },
      { offset: centralOffset + central.length + zip64.length + locator.length, data: end },
    ]);

    const index = await readCbzZipIndex('/books/zip64.cbz');

    expect(index?.entries).toHaveLength(1);
    expect(index?.entries[0].localHeaderOffset).toBe(localOffset);
    await expect(extractCbzZipEntry('/books/zip64.cbz', index!.entries[0])).resolves.toEqual(entry.data);
  });

  it('returns an index with zero entries for a ZIP with no files (only EOCD)', async () => {
    const empty = Buffer.alloc(22);
    empty.writeUInt32LE(0x06054b50, 0);
    mockBufferFile(empty);

    const index = await readCbzZipIndex('/books/empty.cbz');

    expect(index).not.toBeNull();
    expect(index?.entries).toHaveLength(0);
    expect(index?.comment).toBeNull();
  });

  it('includes entries with unsupported compression in the index so callers can filter', async () => {
    const buf = buildZip([{ name: 'page.jpg', data: Buffer.from([0xde, 0xad]), compression: 99 }]);
    mockBufferFile(buf);

    const index = await readCbzZipIndex('/books/exotic.cbz');

    expect(index?.entries).toHaveLength(1);
    expect(index?.entries[0].compression).toBe(99);
  });
});

describe('isSupportedCbzZipCompression', () => {
  it('returns true for STORED (0) and DEFLATE (8)', () => {
    const base = { name: 'a.jpg', compressedSize: 10, uncompressedSize: 10, localHeaderOffset: 0, dataStart: 30 };
    expect(isSupportedCbzZipCompression({ ...base, compression: 0 })).toBe(true);
    expect(isSupportedCbzZipCompression({ ...base, compression: 8 })).toBe(true);
  });

  it('returns false for any other compression method', () => {
    const base = { name: 'a.jpg', compressedSize: 10, uncompressedSize: 10, localHeaderOffset: 0, dataStart: 30 };
    expect(isSupportedCbzZipCompression({ ...base, compression: 1 })).toBe(false);
    expect(isSupportedCbzZipCompression({ ...base, compression: 99 })).toBe(false);
  });
});

describe('extractCbzZipEntry', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns null for unsupported compression without opening the file', async () => {
    const entry = { name: 'a.jpg', compression: 99, compressedSize: 4, uncompressedSize: 4, localHeaderOffset: 0, dataStart: 30 };
    const result = await extractCbzZipEntry('/books/a.cbz', entry);
    expect(result).toBeNull();
    expect(mockOpen).not.toHaveBeenCalled();
  });
});

describe('createCbzZipEntryReadStream', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns createReadStream result directly for STORED entries', () => {
    const rawStream = { kind: 'raw-stream' };
    mockCreateReadStream.mockReturnValue(rawStream as any);
    const entry = { name: 'p.jpg', compression: 0, compressedSize: 5, uncompressedSize: 5, localHeaderOffset: 0, dataStart: 30 };

    const result = createCbzZipEntryReadStream('/books/a.cbz', entry);

    expect(result).toBe(rawStream);
    expect(mockCreateReadStream).toHaveBeenCalledWith('/books/a.cbz', { start: 30, end: 34 });
  });

  it('pipes createReadStream through createInflateRaw for DEFLATE entries', () => {
    const inflateStream = { kind: 'inflate-stream' };
    const rawStream = { pipe: vi.fn().mockReturnValue(inflateStream) };
    mockCreateReadStream.mockReturnValue(rawStream as any);
    mockCreateInflateRaw.mockReturnValue(inflateStream as any);
    const entry = { name: 'p.jpg', compression: 8, compressedSize: 5, uncompressedSize: 8, localHeaderOffset: 0, dataStart: 30 };

    const result = createCbzZipEntryReadStream('/books/a.cbz', entry);

    expect(result).toBe(inflateStream);
    expect(mockCreateReadStream).toHaveBeenCalledWith('/books/a.cbz', { start: 30, end: 34 });
    expect(mockCreateInflateRaw).toHaveBeenCalled();
    expect(rawStream.pipe).toHaveBeenCalledWith(inflateStream);
  });

  it('returns an empty Readable for entries with compressedSize 0', () => {
    const entry = { name: 'p.jpg', compression: 0, compressedSize: 0, uncompressedSize: 0, localHeaderOffset: 0, dataStart: 30 };

    const result = createCbzZipEntryReadStream('/books/a.cbz', entry);

    expect(result).toBeDefined();
    expect(mockCreateReadStream).not.toHaveBeenCalled();
  });

  it('throws for unsupported compression methods', () => {
    const entry = { name: 'p.jpg', compression: 99, compressedSize: 5, uncompressedSize: 5, localHeaderOffset: 0, dataStart: 30 };
    expect(() => createCbzZipEntryReadStream('/books/a.cbz', entry)).toThrow('Unsupported ZIP compression method: 99');
  });
});
