vi.mock('fs/promises', () => ({ readFile: vi.fn() }));

import { readFile } from 'fs/promises';
import { deflateRawSync } from 'zlib';

import { extractCbzCover } from './cover-cbz';

const mockReadFile = readFile as MockedFunction<typeof readFile>;

interface ZipEntry {
  name: string;
  data: Buffer;
  compression?: 0 | 8;
  /** When true, LFH compressedSize is written as 0 (data descriptor mode). CDR always has the real size. */
  dataDescriptor?: boolean;
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
    const payload = entry.compression === 8 ? deflateRawSync(entry.data) : entry.data;
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

function mockZip(entries: ZipEntry[], eocdComment?: Buffer) {
  const buf = buildZip(entries, eocdComment);
  mockReadFile.mockResolvedValue(buf as unknown as Awaited<ReturnType<typeof readFile>>);
}

describe('extractCbzCover', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns the first visible image (STORED)', async () => {
    mockZip([{ name: '001.jpg', data: Buffer.from([0xff, 0xd8, 0xff]) }]);
    await expect(extractCbzCover('/book.cbz')).resolves.toEqual(Buffer.from([0xff, 0xd8, 0xff]));
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

  it('extracts cover when LFH compressedSize is 0 (data descriptor mode)', async () => {
    // Reproduces the real-world bug: CBZ files produced with data descriptors
    // store compressedSize=0 in the local file header. The CDR always has the
    // correct size and is now the authoritative source.
    mockZip([{ name: 'cover.jpg', data: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), compression: 8, dataDescriptor: true }]);
    await expect(extractCbzCover('/book.cbz')).resolves.toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
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

  it('returns null when no EOCD record is present (truncated or corrupt ZIP)', async () => {
    mockReadFile.mockResolvedValue(Buffer.from('not a zip') as unknown as Awaited<ReturnType<typeof readFile>>);
    await expect(extractCbzCover('/book.cbz')).resolves.toBeNull();
  });

  it('returns null on I/O failure', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    await expect(extractCbzCover('/missing.cbz')).resolves.toBeNull();
  });
});
