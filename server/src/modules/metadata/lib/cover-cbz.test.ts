vi.mock('fs/promises', () => ({ open: vi.fn() }));

import { open } from 'fs/promises';
import { deflateRawSync } from 'zlib';

import { extractCbzCover } from './cover-cbz';

const mockOpen = open as MockedFunction<typeof open>;

interface ZipEntry {
  name: string;
  data: Buffer;
  compression?: number;
  /** When true, LFH compressedSize is written as 0 (data descriptor mode). CDR always has the real size. */
  dataDescriptor?: boolean;
  corruptPayload?: boolean;
}

/**
 * Build a well-formed ZIP buffer with local file headers, a central directory,
 * and an end-of-central-directory record. Optionally appends a comment to the
 * EOCD (simulating ComicTagger-style metadata).
 */
function buildZip(entries: ZipEntry[], eocdComment?: Buffer): Buffer {
  const lfhChunks: Buffer[] = [];
  const cdrChunks: Buffer[] = [];
  let lfhOffset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf-8');
    const payload = Buffer.from(entry.compression === 8 ? deflateRawSync(entry.data) : entry.data);
    if (entry.corruptPayload && payload.length > 0) payload[0] ^= 0xff;
    const lfhCompressedSize = entry.dataDescriptor ? 0 : payload.length;

    const lfh = Buffer.alloc(30 + nameBuf.length);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(entry.dataDescriptor ? 0x0008 : 0, 6);
    lfh.writeUInt16LE(entry.compression ?? 0, 8);
    lfh.writeUInt32LE(lfhCompressedSize, 18);
    lfh.writeUInt32LE(entry.data.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);
    nameBuf.copy(lfh, 30);

    const lfhBlock = Buffer.concat([lfh, payload]);
    lfhChunks.push(lfhBlock);

    const cdr = Buffer.alloc(46 + nameBuf.length);
    cdr.writeUInt32LE(0x02014b50, 0);
    cdr.writeUInt16LE(20, 4);
    cdr.writeUInt16LE(20, 6);
    cdr.writeUInt16LE(entry.dataDescriptor ? 0x0008 : 0, 8);
    cdr.writeUInt16LE(entry.compression ?? 0, 10);
    cdr.writeUInt32LE(payload.length, 20); // always correct in CDR
    cdr.writeUInt32LE(entry.data.length, 24);
    cdr.writeUInt16LE(nameBuf.length, 28);
    cdr.writeUInt32LE(lfhOffset, 42);
    nameBuf.copy(cdr, 46);
    cdrChunks.push(cdr);

    lfhOffset += lfhBlock.length;
  }

  const cdData = Buffer.concat(cdrChunks);
  const comment = eocdComment ?? Buffer.alloc(0);

  const eocd = Buffer.alloc(22 + comment.length);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdData.length, 12);
  eocd.writeUInt32LE(lfhOffset, 16);
  eocd.writeUInt16LE(comment.length, 20);
  comment.copy(eocd, 22);

  return Buffer.concat([...lfhChunks, cdData, eocd]);
}

function mockZip(entries: ZipEntry[], eocdComment?: Buffer): Buffer {
  const buf = buildZip(entries, eocdComment);
  mockBufferFile(buf);
  return buf;
}

function mockBufferFile(buf: Buffer): void {
  mockOpen.mockImplementation(() => {
    const handle = {
      stat: vi.fn().mockResolvedValue({ size: buf.length }),
      close: vi.fn().mockResolvedValue(undefined),
      read: vi.fn((target: Buffer, targetOffset: number, length: number, position: number) => {
        if (position >= buf.length) return Promise.resolve({ bytesRead: 0, buffer: target });
        const bytesRead = buf.copy(target, targetOffset, position, Math.min(position + length, buf.length));
        return Promise.resolve({ bytesRead, buffer: target });
      }),
    };
    return Promise.resolve(handle as unknown as Awaited<ReturnType<typeof open>>);
  });
}

function eocdOffset(buf: Buffer): number {
  return buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
}

function centralDirectoryOffset(buf: Buffer): number {
  return buf.readUInt32LE(eocdOffset(buf) + 16);
}

describe('extractCbzCover', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns the first visible image (STORED)', async () => {
    mockZip([{ name: '001.jpg', data: Buffer.from([0xff, 0xd8, 0xff]) }]);
    await expect(extractCbzCover('/book.cbz')).resolves.toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  it('returns the first visible image by natural filename order instead of ZIP entry order', async () => {
    mockZip([
      { name: '010.jpg', data: Buffer.from([0x10]) },
      { name: '001.jpg', data: Buffer.from([0x01]) },
      { name: '002.jpg', data: Buffer.from([0x02]) },
    ]);

    await expect(extractCbzCover('/book.cbz')).resolves.toEqual(Buffer.from([0x01]));
  });

  it('uses natural numeric sorting when choosing between page names', async () => {
    mockZip([
      { name: 'page10.jpg', data: Buffer.from([0x10]) },
      { name: 'page2.jpg', data: Buffer.from([0x02]) },
    ]);

    await expect(extractCbzCover('/book.cbz')).resolves.toEqual(Buffer.from([0x02]));
  });

  it('skips hidden image files and returns first visible image', async () => {
    mockZip([
      { name: '.hidden.jpg', data: Buffer.from([0xaa]) },
      { name: '001.jpg', data: Buffer.from([0xff, 0xd8, 0xff]) },
    ]);
    await expect(extractCbzCover('/book.cbz')).resolves.toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  it('inflates DEFLATE-compressed entries', async () => {
    mockZip([{ name: 'page1.png', data: Buffer.from([1, 2, 3, 4]), compression: 8 }]);
    await expect(extractCbzCover('/book.cbz')).resolves.toEqual(Buffer.from([1, 2, 3, 4]));
  });

  it('skips unsupported image compression methods and continues to the next image', async () => {
    mockZip([
      { name: '001.jpg', data: Buffer.from([0x01]), compression: 99 },
      { name: '002.jpg', data: Buffer.from([0x02]) },
    ]);

    await expect(extractCbzCover('/book.cbz')).resolves.toEqual(Buffer.from([0x02]));
  });

  it('extracts cover when LFH compressedSize is 0 (data descriptor mode)', async () => {
    // Reproduces the real-world bug: CBZ files produced with data descriptors
    // store compressedSize=0 in the local file header. The CDR always has the
    // correct size and is now the authoritative source.
    mockZip([{ name: 'cover.jpg', data: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), compression: 8, dataDescriptor: true }]);
    await expect(extractCbzCover('/book.cbz')).resolves.toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  });

  it('sorts data-descriptor entries before extracting the cover', async () => {
    mockZip([
      { name: '010.jpg', data: Buffer.from([0x10]), compression: 8, dataDescriptor: true },
      { name: '001.jpg', data: Buffer.from([0x01]), compression: 8, dataDescriptor: true },
    ]);

    await expect(extractCbzCover('/book.cbz')).resolves.toEqual(Buffer.from([0x01]));
  });

  it('handles a ZIP with a large EOCD comment (e.g. ComicTagger metadata)', async () => {
    const comment = Buffer.alloc(1024, 0x42); // 1 KB comment
    mockZip([{ name: 'p001.jpg', data: Buffer.from([0xde, 0xad]) }], comment);
    await expect(extractCbzCover('/book.cbz')).resolves.toEqual(Buffer.from([0xde, 0xad]));
  });

  it('skips directory entries', async () => {
    mockZip([
      { name: 'images/', data: Buffer.alloc(0) },
      { name: 'images/001.png', data: Buffer.from([0x89, 0x50]) },
    ]);
    await expect(extractCbzCover('/book.cbz')).resolves.toEqual(Buffer.from([0x89, 0x50]));
  });

  it('returns null when the archive contains no image files', async () => {
    mockZip([{ name: 'notes.txt', data: Buffer.from('hello') }]);
    await expect(extractCbzCover('/book.cbz')).resolves.toBeNull();
  });

  it('returns null when sorted image candidates cannot be extracted', async () => {
    mockZip([{ name: '001.jpg', data: Buffer.from([1, 2, 3, 4]), compression: 8, corruptPayload: true }]);
    await expect(extractCbzCover('/book.cbz')).resolves.toBeNull();
  });

  it('returns null when the central directory bounds are invalid', async () => {
    const buf = mockZip([{ name: '001.jpg', data: Buffer.from([0x01]) }]);
    buf.writeUInt32LE(buf.length, eocdOffset(buf) + 16);

    await expect(extractCbzCover('/book.cbz')).resolves.toBeNull();
  });

  it('returns null when a central directory entry is truncated', async () => {
    const buf = mockZip([{ name: '001.jpg', data: Buffer.from([0x01]) }]);
    buf.writeUInt16LE(1000, centralDirectoryOffset(buf) + 28);

    await expect(extractCbzCover('/book.cbz')).resolves.toBeNull();
  });

  it('returns null when a selected image points outside the local file headers', async () => {
    const buf = mockZip([{ name: '001.jpg', data: Buffer.from([0x01]) }]);
    buf.writeUInt32LE(buf.length, centralDirectoryOffset(buf) + 42);

    await expect(extractCbzCover('/book.cbz')).resolves.toBeNull();
  });

  it('returns null when selected image payload bounds are invalid', async () => {
    const buf = mockZip([{ name: '001.jpg', data: Buffer.from([0x01]) }]);
    buf.writeUInt32LE(buf.length, centralDirectoryOffset(buf) + 20);

    await expect(extractCbzCover('/book.cbz')).resolves.toBeNull();
  });

  it('returns null when no EOCD record is present (truncated or corrupt ZIP)', async () => {
    mockBufferFile(Buffer.from('not a zip'));
    await expect(extractCbzCover('/book.cbz')).resolves.toBeNull();
  });

  it('returns null on I/O failure', async () => {
    mockOpen.mockRejectedValue(new Error('ENOENT'));
    await expect(extractCbzCover('/missing.cbz')).resolves.toBeNull();
  });
});
